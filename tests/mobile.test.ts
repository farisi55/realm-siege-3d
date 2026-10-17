// @vitest-environment jsdom
// The automated half of the mobile QA checklist, one describe per checklist line:
//   1-3  Q/W/E fire exactly that slot's ability (its own cooldown + mana from the hero kit)
//   4    R fires the ultimate only from level 3    5 one tap never double-fires    6 no order leaks
//   7    battlefield touch still moves / targets, two-finger pinch zooms
//   8    minimap, inventory and shop stay touchable
//   9-10 HUD compactness and portrait/landscape — asserted against the responsive CSS contract, because
//        jsdom has no layout engine (real hit-testing and safe areas still need a device)
//   11   desktop keyboard + mouse parity   12 pause / respawn / restart
// Boot harness mirrors tests/ui.test.ts: mount() + boot(), stubbed WebGL, flush() after every state change.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('three', async orig => {
  const t: any = await orig();
  return { ...t, WebGLRenderer: class { domElement = document.createElement('canvas'); shadowMap: any = {}; setPixelRatio() {} setSize() {} render() {} } };
});

let F: any, S: any, C: any, CM: any;
const el = (id: string) => document.getElementById(id)!;
const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const cv = () => document.querySelector('#g canvas') as HTMLElement;
const frames = (n: number) => { for (let i = 0; i < n; i++) F.frame(1 / 30); };
const key = (type: string, k: string) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
/** Lets React commit the render it scheduled for the state change that just happened. */
const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));
/** Waits past the 160 ms per-slot tap window in input.ts, so the next gesture on the same slot is live. */
const settle = (): Promise<void> => new Promise(r => setTimeout(r, 220));
const button = (text: string, root: ParentNode = document): HTMLButtonElement =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
const absB = () => $$('#abs .ab') as HTMLButtonElement[];
/** Dispatches the pointerdown a tap starts with. */
const tap = (target: Element, init: MouseEventInit = { button: 0 }) =>
  target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, ...init }));
/** A touch pointer event as the raw listeners in input.ts read it (jsdom has no PointerEvent constructor). */
const touchEv = (type: string, x: number, y: number, id: number, primary: boolean): any =>
  Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: x, clientY: y, pointerId: id, pointerType: 'touch', isPrimary: primary, button: 0 });
const ab = (i: number): any => S.app.me.def.ab[i];
/** Known castable state: alive, ample mana (999), no cooldowns, no orders, no stun. */
const ready = (): any => {
  const me = S.app.me;
  me.dead = false; me.hp = me.max; me.st = 0;
  me.mmax = Math.max(me.mmax, 999); me.mp = 999;
  me.acd = [0, 0, 0, 0]; me.mv = null; me.tgt = null;
  return me;
};

const css = readFileSync('src/style.css', 'utf8');
/** The brace-balanced body of one at-rule, so a rule is asserted inside the right responsive block. */
const block = (header: string): string => {
  const i = css.indexOf(header);
  if (i < 0) throw new Error(`style.css no longer contains "${header}"`);
  let depth = 0, j = css.indexOf('{', i);
  for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}' && --depth === 0) break; }
  return css.slice(css.indexOf('{', i), j + 1);
};

beforeAll(async () => {
  localStorage.setItem('rs_bloom', 'false');
  const html = readFileSync('index.html', 'utf8');
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));
  const ctx = new Proxy({}, { get: (t: any, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t: any, k, v) => ((t[k] = v), true) });
  (HTMLCanvasElement.prototype as any).getContext = () => ctx;
  await import('../src/render/environment');
  CM = await import('../src/render/camera');
  C = await import('../src/game/sim/combat');
  S = await import('../src/game/state');
  F = await import('../src/flow');
  const M = await import('../src/ui/mount');
  M.mount();
  await F.boot();
  await flush(); // menu committed
  button('Play').click(); await flush();
  frames(340); // past the 10 s prep countdown: casts and battlefield orders are live
}, 30000);

describe('mobile QA checklist (automated half)', () => {
  for (const [i, slot] of [[0, 'Q'], [1, 'W'], [2, 'E']] as const) {
    it(`${i + 1}. tapping ${slot} runs exactly the ${slot} ability — its own cooldown and mana from the kit`, async () => {
      const me = ready(); await settle();
      tap(absB()[i]);
      expect(me.acd[i]).toBe(ab(i)[3]); // cast() sets this slot's own cooldown
      expect(me.mp).toBe(999 - ab(i)[4]); // and charges this slot's own mana
      for (const j of [0, 1, 2, 3]) if (j !== i) expect(me.acd[j]).toBe(0); // no other slot fired
      expect(me.mv).toBeNull(); expect(me.tgt).toBeNull();
    });
  }

  it('4. R runs the ultimate only when available (level 3)', async () => {
    const me = ready(), lv0 = me.lv;
    me.lv = 1; await settle(); tap(absB()[3]);
    expect(me.acd[3]).toBe(0); // locked below Lv3
    expect(me.mp).toBe(999); // rejected taps pay nothing
    me.acd = [0, 0, 0, 0]; me.lv = 3; await settle(); tap(absB()[3]);
    expect(me.acd[3]).toBe(ab(3)[3]); expect(me.mp).toBe(999 - ab(3)[4]);
    me.lv = lv0;
  });

  it('5. one tap never triggers the skill twice (pointerdown + click pair)', async () => {
    const me = ready(); await settle();
    tap(absB()[0]);
    const after = me.mp, cd = me.acd[0];
    expect(after).toBe(999 - ab(0)[4]);
    // A tap also delivers a click; AT/keyboard activation rides click with detail 0 — neither may re-cast.
    absB()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 1 }));
    absB()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail: 0 }));
    expect(me.mp).toBe(after);
    expect(me.acd[0]).toBe(cd);
  });

  it('6. pressing a skill button never moves or retargets the hero', async () => {
    const me = ready(); await settle();
    tap(absB()[1]);
    expect(me.acd[1]).toBe(ab(1)[3]); // it did cast…
    expect(me.mv).toBeNull(); expect(me.tgt).toBeNull(); // …without issuing any battlefield order
    const x0 = me.x, y0 = me.y; frames(6);
    expect(Math.hypot(me.x - x0, me.y - y0)).toBeLessThan(2); // and the hero stays put
  });

  it('7. battlefield touch still moves (ground) and targets (enemy)', () => {
    const me = ready();
    const saved = S.app.all.map((u: any) => ({ u, x: u.x, y: u.y }));
    S.app.all.forEach((u: any) => { if (u.team !== 0) { u.x = 3800; u.y = 3800; } }); // guarantee an empty ground tap
    const pt = { clientX: innerWidth / 2, clientY: innerHeight * .35 };
    const w = CM.wpt(pt); // the exact world point the handler will compute for this screen point
    tap(cv(), pt);
    expect(me.tgt).toBeNull();
    expect(me.mv).toEqual(w); // ground tap: a plain move order
    const enemy = saved.map(s => s.u).find((u: any) => u.k === 'hero' && u.team === 1 && !u.dead)!;
    enemy.x = w.x; enemy.y = w.y;
    tap(cv(), pt);
    expect(me.tgt).toBe(enemy); expect(me.mv).toBeNull(); // unit tap: target order instead
    saved.forEach(s => { s.u.x = s.x; s.u.y = s.y; });
  });

  it('7b. two-finger pinch zooms the camera; the second finger issues no order', () => {
    const me = ready();
    cv().dispatchEvent(touchEv('pointerdown', 300, 300, 11, true)); // first finger: the normal tap-to-move
    const ord = me.mv;
    cv().dispatchEvent(touchEv('pointerdown', 500, 300, 12, false)); // second finger must not order
    expect(me.mv).toBe(ord);
    const cd0 = S.app.cam.cd;
    cv().dispatchEvent(touchEv('pointermove', 640, 300, 12, false)); // pinch out: finger span 200 -> 340
    frames(30);
    expect(S.app.cam.cd).toBeLessThan(cd0 - 1); // camZoom() ran: the camera moved closer to the ground
    cv().dispatchEvent(touchEv('pointerup', 640, 300, 12, false));
    cv().dispatchEvent(touchEv('pointerup', 300, 300, 11, true));
  });

  it('8. minimap, inventory and shop stay touchable without side effects', async () => {
    const me = ready();
    // The minimap and inventory slots carry no action in this game, but a touch on them must stay theirs:
    // it may not fall through and cast or order anything.
    tap(el('mm')); tap($$('#its .sl')[0]);
    expect(me.mv).toBeNull(); expect(me.tgt).toBeNull(); expect(me.acd[0]).toBe(0);
    // The shop opens, absorbs taps on its panel and can be bought from with the click a tap produces.
    me.g = 5000; const n0 = me.it.length;
    button('Shop (B)').click(); await flush();
    expect(el('shop')).toBeTruthy();
    tap(el('shop'));
    expect(me.mv).toBeNull(); expect(me.tgt).toBeNull(); expect(me.acd[0]).toBe(0);
    ($$('#shop .cards')[0].children[0].querySelector('button') as HTMLElement).click(); await flush();
    expect(me.it.length).toBe(n0 + 1); expect(me.g).toBeLessThan(5000);
    button('Close (B)').click(); await flush();
    expect(document.getElementById('shop')).toBeNull();
  });

  describe('9. the HUD does not dominate the mobile screen (CSS contract; jsdom has no layout engine)', () => {
    const compact = () => block('@media (max-width:960px),(pointer:coarse) and (max-height:520px)');
    it('the minimap becomes a corner chip and the bottom bar respects safe areas', () => {
      const c = compact();
      expect(c).toContain('width:clamp(84px,20vh,124px)');
      expect(c).toContain('bottom:auto'); // tucked to the top-left, off the thumb zone
      expect(c).toContain('aspect-ratio:1');
      expect(c).toContain('touch-action:none');
      expect(c).toContain('flex-wrap:nowrap');
      expect(c).toContain('env(safe-area-inset-bottom');
    });
    it('ability buttons keep a tap-friendly floor while decorations shrink around them', () => {
      const c = compact();
      expect(c).toContain('width:clamp(42px,11vw,52px)');
      expect(c).toContain('aspect-ratio:1');
      expect(c).toContain('#pic{width:40px;height:40px');
      expect(c).toContain('.sl{width:26px;height:26px');
      expect(c).toContain('#abs{order:5}'); // thumb order: abilities and attack last, lower-right
    });
    it('panels own their taps; labels and cooldown overlays never intercept one', () => {
      expect(compact()).toContain('#top,#bot,#mm{pointer-events:auto}');
      expect(css).toContain('#hud{position:absolute;inset:0;pointer-events:none');
      expect(css).toContain('#hud button{pointer-events:auto}');
      expect(css).toContain('.ab b,.ab span,.ab u{pointer-events:none}');
      expect(css).toContain('.ab u:empty{display:none}');
      expect(css).toContain('#g canvas{display:block;touch-action:none}');
      expect(css).toContain('@media (hover:none)');
      expect(css).toContain('touch-action:manipulation');
    });
    it('every ability state and the press feedback are styled; touch controls exist', () => {
      for (const sel of ['.ab.ready', '.ab.cd', '.ab.nomana', '.ab.locked', '.ab.dead', '#hud .ab:active']) expect(css).toContain(sel);
      expect(css).toContain('@supports (height:100dvh)');
      expect(css).toContain('env(safe-area-inset-top');
      const coarse = block('@media (pointer:coarse){');
      expect(coarse).toContain('#pause{display:block}');
      expect(coarse).toContain('#atk{display:flex');
      expect(css).toContain('@media (orientation:portrait) and (pointer:coarse)'); // rotation hint: portrait only…
      expect(css).toContain('#rot{display:none'); // …and hidden everywhere else
    });
  });

  describe('10. portrait and landscape stay proportional (CSS contract)', () => {
    it('portrait: two-row thumb grid, minimap under the score bar, no feed overlay', () => {
      const p = block('@media (orientation:portrait) and (max-width:620px)');
      expect(p).toContain('grid-template-areas:"pic stats shop" "its abs atk"');
      expect(p).toContain('#atk{grid-area:atk;justify-self:end}');
      expect(p).toContain('width:clamp(38px,11.5vw,50px)');
      expect(p).toContain('width:clamp(72px,22vw,104px)');
      expect(p).toContain('#feed{display:none}');
    });
    it('short landscape drops inventory and objectives, never the abilities', () => {
      const l = block('@media (max-width:700px) and (orientation:landscape)');
      expect(l).toContain('#its{display:none}');
      expect(l).toContain('#ob{display:none}');
      expect(l).not.toContain('#abs'); // the skill buttons are never hidden
    });
  });

  describe('11. desktop keyboard and mouse keep working', () => {
    it('keyboard Q still casts the same slot at the cursor', async () => {
      const me = ready(); await settle();
      key('keydown', 'q');
      expect(me.acd[0]).toBe(ab(0)[3]); expect(me.mp).toBe(999 - ab(0)[4]);
    });
    it('a mouse click on a skill button lands on the same activation path', async () => {
      const me = ready(); await settle();
      tap(absB()[2]); // pointerdown from a plain mouse (no pointerType)
      expect(me.acd[2]).toBe(ab(2)[3]);
    });
    it('arrow keys still drive the hero', () => {
      const me = ready(); me.x = 1600; me.y = 2200; frames(5);
      const x0 = me.x, y0 = me.y;
      key('keydown', 'ArrowUp'); frames(30); key('keyup', 'ArrowUp');
      expect(S.app.keys.up.isDown).toBe(false);
      expect(Math.hypot(me.x - x0, me.y - y0)).toBeGreaterThan(100);
    });
    it('right click still sets a ground move target and the wheel still zooms', () => {
      const me = ready();
      const pt = { button: 2, clientX: innerWidth / 2, clientY: innerHeight / 2 };
      const w = CM.wpt(pt);
      tap(cv(), pt);
      expect(me.mv).toEqual(w); expect(me.tgt).toBeNull();
      const cd0 = S.app.cam.cd;
      const wheel: any = typeof WheelEvent === 'function' ? new WheelEvent('wheel', { deltaY: 240, cancelable: true }) : Object.assign(new Event('wheel', { cancelable: true }), { deltaY: 240 });
      cv().dispatchEvent(wheel);
      frames(30);
      expect(S.app.cam.cd).toBeGreaterThan(cd0 + 1); // zoomed out, as the wheel asked
    });
    it('middle-drag still rotates the camera', () => {
      cv().dispatchEvent(new MouseEvent('pointerdown', { button: 1, clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 420, clientY: 300 }));
      window.dispatchEvent(new MouseEvent('pointerup'));
      const cy0 = S.app.cam.cy;
      frames(30);
      expect(Math.abs(S.app.cam.cy - cy0)).toBeGreaterThan(.05); // yaw glided to the new angle
    });
  });

  describe('12. pause, respawn and restart never break touch controls', () => {
    it('pause blocks skill taps; Resume restores them', async () => {
      el('pause').click(); await flush();
      expect(S.app.G.pause).toBe(true);
      const me = ready(); await settle(); tap(absB()[0]); expect(me.acd[0]).toBe(0);
      button('Resume').click(); await flush();
      expect(S.app.G.pause).toBe(false);
      ready(); await settle(); tap(absB()[0]); expect(me.acd[0]).toBe(ab(0)[3]);
    });
    it('a dead hero cannot cast by tap; the same tap works after respawn', async () => {
      const me = ready(); me.dead = true; me.hp = 0; me.rs = .5;
      await settle(); tap(absB()[0]); expect(me.acd[0]).toBe(0);
      frames(24); // hup() counts rs down and respawns at the team spawn
      expect(me.dead).toBe(false); expect(me.hp).toBeGreaterThan(0);
      ready(); await settle(); tap(absB()[0]); expect(me.acd[0]).toBe(ab(0)[3]);
    });
    it('Play Again rebuilds the match and the touch buttons still cast', async () => {
      const me = S.app.me;
      S.app.all.filter((u: any) => u.k === 'tower' && u.team === 1).forEach((t: any) => C.hurt(me, t, 1e6));
      C.hurt(me, S.app.all.find((u: any) => u.k === 'core' && u.team === 1), 1e6);
      frames(3); await flush();
      button('Play Again').click(); await flush();
      expect(S.app.G.over).toBe(false); expect(S.app.G.t).toBeLessThan(1);
      frames(340); // a fresh match starts with its own 10 s prep
      expect(absB()).toHaveLength(4);
      const me2 = ready(); await settle(); tap(absB()[0]);
      expect(me2.acd[0]).toBe(ab(0)[3]);
    });
  });
});
