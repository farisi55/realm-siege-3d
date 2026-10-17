import { describe, it, expect, beforeEach } from 'vitest';
import { createWorld, stepSim } from '../src/game/sim/world';
import { app, hooks } from '../src/game/state';
import { hurt, cast } from '../src/game/sim/combat';
import { rc, mk } from '../src/game/sim/units';
import { IT } from '../src/game/config';
import { OB } from '../src/game/map';

let winner = -1;
const run = (sec: number) => { for (let i = 0; i < sec * 30; i++) { stepSim(1 / 30); if (app.G.over) break; } };
const heroes = (t: number) => app.all.filter(u => u.k === 'hero' && u.team === t);
const kind = (k: string, t?: number) => app.all.filter(u => u.k === k && (t === undefined || u.team === t));

beforeEach(() => {
  winner = -1;
  hooks.finish = w => { winner = w; app.G.over = true; app.G.win = w; };
  createWorld();
});

describe('simulation (no DOM, no Three.js)', () => {
  it('creates 5v5 heroes, 12 towers, 2 cores and jungle monsters', () => {
    expect(heroes(0)).toHaveLength(5); expect(heroes(1)).toHaveLength(5);
    expect(kind('tower')).toHaveLength(12); expect(kind('core')).toHaveLength(2);
    expect(app.all.filter(u => u.team === 2)).toHaveLength(13);
  });
  it('spawns creeps after the 10s preparation and walks them along the lane', () => {
    run(9); expect(kind('melee')).toHaveLength(0);
    run(3); expect(kind('melee', 0).length).toBeGreaterThan(0); expect(kind('melee', 1).length).toBeGreaterThan(0);
    const c = kind('melee', 0)[0], x0 = c.x, y0 = c.y; run(5);
    expect(Math.hypot(c.x - x0, c.y - y0)).toBeGreaterThan(50);
  });
  it('melee attacks land after the wind-up and award gold and xp', () => {
    run(11); const me = app.me; me.x = 1300; me.y = 1300; // neutral ground, away from towers and the core
    app.all.filter(u => u.k === 'hero' && u !== me).forEach(h => { h.dead = true; h.rs = 1e9; }); // keep AI heroes from stealing the kill
    const e = mk({ k: 'melee', team: 1, L: 1, wp: 1, x: me.x + 60, y: me.y, hp: 300, dmg: 0, rng: 75, as: 1000, ar: 0, r: 12, g: 22, xp: 42 });
    const g0 = me.g, x0 = me.xp; me.tgt = e; run(8);
    expect(e.dead).toBe(true); expect(me.g).toBeGreaterThan(g0 + 20); expect(me.xp).toBeGreaterThan(x0);
  });
  it('abilities use mana, start a cooldown and fire after the cast time', () => {
    run(11); const me = app.me, mp = me.mp; app.P.length = 0;
    cast(me, 0, me.x + 300, me.y);
    expect(me.acd[0]).toBeGreaterThan(0); expect(me.mp).toBeLessThan(mp);
    expect(app.P.some(p => p.s === me)).toBe(false);
    run(.5); expect(app.P.some(p => p.s === me)).toBe(true);
    const cd = me.acd[0]; cast(me, 0, me.x + 300, me.y); expect(me.acd[0]).toBe(cd);
  });
  it('items change hero stats', () => {
    const me = app.me, d0 = me.dmg, hp0 = me.max;
    me.it.push({ n: IT[0][0], c: IT[0][1], b: IT[0][2] }, { n: IT[4][0], c: IT[4][1], b: IT[4][2] }); rc(me);
    expect(me.dmg).toBe(d0 + 25); expect(Math.round(me.max - hp0)).toBe(280);
  });
  it('heroes die, credit the kill, and respawn at full health', () => {
    run(11); const me = app.me, en = heroes(1)[0], k0 = app.G.k[1], l0 = en.kl;
    hurt(en, me, 1e6); expect(me.dead).toBe(true); expect(app.G.k[1]).toBe(k0 + 1); expect(en.kl).toBe(l0 + 1);
    run(me.rs + 1); expect(me.dead).toBe(false); expect(me.hp).toBe(me.max);
  });
  it('victory when the enemy core falls, defeat when the own core falls', () => {
    run(11); kind('tower', 1).forEach(t => hurt(app.me, t, 1e6)); hurt(app.me, kind('core', 1)[0], 1e6); expect(winner).toBe(0);
    createWorld(); winner = -1; run(11); hurt(heroes(1)[0], kind('core', 0)[0], 1e9); expect(winner).toBe(1);
  });
  it('units never end a frame inside terrain obstacles', { timeout: 60000 }, () => {
    app.me.ai = true; run(240);
    const bad = app.all.filter(u => !u.dead && u.k !== 'tower' && u.k !== 'core').filter(u => OB.some(o => Math.hypot(u.x - o.x, u.y - o.y) < u.r + o.r - 3));
    expect(bad).toHaveLength(0);
  });
  it('AI-controlled teams play a full match to the end', () => {
    app.me.ai = true; run(1500);
    expect(winner === 0 || winner === 1).toBe(true); expect(app.G.t).toBeLessThan(1500);
  }, 60000);
});
