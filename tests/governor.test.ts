import { describe, it, expect } from 'vitest';
import { GOVERNOR, Governor, LEVELS, MAX_LEVEL } from '../src/render/governor';

// The governor is pure: frame times in, level out. Everything here runs without a DOM or a GPU, and in simulated time.

/** Feeds frames of `ms` for `seconds` of simulated time; returns the level after each change as [time, level]. */
function run(g: Governor, ms: number, seconds: number, t0 = 0): { t: number; level: number }[] {
  const changes: { t: number; level: number }[] = [];
  let t = 0, last = g.level;
  while (t < seconds) {
    const l = g.sample(ms);
    t += ms / 1000;
    if (l !== last) { changes.push({ t: t0 + t, level: l }); last = l; }
  }
  return changes;
}

describe('levels', () => {
  it('rise from the cheapest to the best: nothing a lower level has is better than the level above it', () => {
    expect(MAX_LEVEL).toBe(LEVELS.length - 1);
    for (let i = 1; i < LEVELS.length; i++) {
      const a = LEVELS[i - 1], b = LEVELS[i];
      expect(b.dpr, 'dpr').toBeGreaterThan(a.dpr);
      expect(b.shadow, 'shadow').toBeGreaterThanOrEqual(a.shadow);
      expect(b.reach, 'reach').toBeGreaterThan(a.reach);
      expect(b.flies, 'flies').toBeGreaterThanOrEqual(a.flies);
      expect(b.rune, 'rune').toBeGreaterThanOrEqual(a.rune);
      expect(Number(b.bloom), 'bloom').toBeGreaterThanOrEqual(Number(a.bloom));
    }
  });
  it('the best level is the full picture: all the grass, a 2048 shadow map, bloom on', () => {
    const top = LEVELS[MAX_LEVEL];
    expect(top.reach).toBe(1); expect(top.shadow).toBe(2048); expect(top.bloom).toBe(true); expect(top.flies).toBeGreaterThan(0);
  });
  it('only the cheapest level gives up the bloom and the fireflies, and no level looks hazy or dim: the glow of the runes stays within a narrow band', () => {
    expect(LEVELS[0].bloom).toBe(false); expect(LEVELS[0].flies).toBe(0);
    for (const l of LEVELS.slice(1)) { expect(l.bloom).toBe(true); expect(l.flies).toBeGreaterThan(0); }
    const runes = LEVELS.map(l => l.rune);
    expect(Math.max(...runes) - Math.min(...runes)).toBeLessThan(.2);
  });
  it('the thresholds leave a band between "too slow" and "headroom", and 60 Hz vsync counts as headroom', () => {
    expect(GOVERNOR.up).toBeGreaterThan(1000 / 60); // a steady 16.7 ms frame can climb
    expect(GOVERNOR.down).toBeGreaterThan(GOVERNOR.up + 3); // hysteresis
    expect(GOVERNOR.down).toBeLessThan(1000 / 30); // but a sustained 30 fps always drops
    expect(GOVERNOR.stall).toBeGreaterThan(GOVERNOR.down * 4);
    expect(GOVERNOR.maxWait).toBeGreaterThanOrEqual(GOVERNOR.wait * 2);
  });
});

describe('Governor', () => {
  it('starts at the best level and stays there while frames are on time', () => {
    const g = new Governor();
    expect(g.level).toBe(MAX_LEVEL);
    expect(run(g, 1000 / 60, 120)).toEqual([]);
    expect(g.level).toBe(MAX_LEVEL);
  });
  it('can start lower, and clamps the start level', () => {
    expect(new Governor(3, 1).level).toBe(1);
    expect(new Governor(3, 99).level).toBe(3);
    expect(new Governor(3, -4).level).toBe(0);
  });
  it('decides nothing during the grace period, then drops after a sustained slow stretch', () => {
    const g = new Governor();
    const grace = GOVERNOR.grace, hold = GOVERNOR.downFor;
    expect(run(g, 40, grace - .2)).toEqual([]); // still in grace: nothing, however slow
    expect(g.level).toBe(MAX_LEVEL);
    const ch = run(g, 40, hold + 1, grace - .2);
    expect(ch.length).toBeGreaterThanOrEqual(1);
    expect(ch[0].level).toBe(MAX_LEVEL - 1);
    expect(ch[0].t).toBeGreaterThanOrEqual(grace + hold - .3); // not before the hold time has passed
    expect(ch[0].t).toBeLessThan(grace + hold + .6);
  });
  it('keeps falling one step at a time while the frames stay slow, and stops at the cheapest level', () => {
    const g = new Governor();
    const ch = run(g, 45, 90);
    expect(ch.map(c => c.level)).toEqual([2, 1, 0]);
    for (let i = 1; i < ch.length; i++) expect(ch[i].t - ch[i - 1].t).toBeGreaterThanOrEqual(GOVERNOR.grace + GOVERNOR.downFor - .3); // each new level gets its own grace
    expect(g.level).toBe(0);
    run(g, 45, 30);
    expect(g.level).toBe(0);
  });
  it('a one-second hitch in good frames does not drop the level', () => {
    const g = new Governor();
    run(g, 1000 / 60, 10);
    run(g, 50, .5);
    run(g, 1000 / 60, 10);
    expect(g.level).toBe(MAX_LEVEL);
  });
  it('ignores stalls (a hidden tab, a long load) and nonsense frame times', () => {
    const g = new Governor();
    const avg = g.average;
    for (let i = 0; i < 500; i++) g.sample(GOVERNOR.stall + 1 + i);
    for (const bad of [0, -5, NaN, Infinity]) for (let i = 0; i < 100; i++) g.sample(bad);
    expect(g.level).toBe(MAX_LEVEL);
    expect(g.average).toBe(avg);
  });
  it('the frame time average follows the frames (and starts over after a change of level, whose cost has to show first)', () => {
    const g = new Governor();
    run(g, 25, 2.5); // inside the grace period: measured, nothing decided
    expect(g.average).toBeGreaterThan(24); expect(g.average).toBeLessThan(25.01);
    let n = 0;
    while (g.sample(25) === MAX_LEVEL && n++ < 1000) { /* until the level drops */ }
    expect(g.level).toBe(MAX_LEVEL - 1);
    expect(g.average).toBeCloseTo(1000 / 60, 6);
  });
  it('a frame time between "headroom" and "too slow" changes nothing, however long it lasts', () => {
    const g = new Governor(3, 2);
    const mid = (GOVERNOR.up + GOVERNOR.down) / 2;
    expect(run(g, mid, 300)).toEqual([]);
    expect(g.level).toBe(2);
  });
  it('climbs only after a long stretch of headroom, one level at a time, never above the maximum', () => {
    const g = new Governor(3, 0);
    const ch = run(g, 10, 120);
    expect(ch.map(c => c.level)).toEqual([1, 2, 3]);
    expect(ch[0].t).toBeGreaterThanOrEqual(GOVERNOR.grace + GOVERNOR.wait - .1);
    expect(ch[0].t).toBeLessThan(GOVERNOR.grace + GOVERNOR.wait + 1);
    expect(g.level).toBe(MAX_LEVEL);
  });
  it('a climb that is followed by a fall doubles the patience; a calm climb does not', () => {
    const g = new Governor(3, 1);
    expect(g.wait).toBe(GOVERNOR.wait);
    let ch = run(g, 10, GOVERNOR.grace + GOVERNOR.wait + 2); // climbs to 2
    expect(ch.map(c => c.level)).toEqual([2]);
    expect(g.wait).toBe(GOVERNOR.wait);
    ch = run(g, 40, 6); // ... and falls soon after: regretted
    expect(ch.map(c => c.level)).toEqual([1]);
    expect(g.wait).toBe(GOVERNOR.wait * 2);
    // with the doubled patience, the same headroom no longer climbs after the old wait
    expect(run(g, 10, GOVERNOR.grace + GOVERNOR.wait + 2)).toEqual([]);
    expect(g.level).toBe(1);
    expect(run(g, 10, GOVERNOR.wait + 2).map(c => c.level)).toEqual([2]);
  });
  it('the patience never grows past its limit', () => {
    const g = new Governor(3, 1);
    for (let round = 0; round < 8; round++) {
      while (g.level < 2) run(g, 10, 5);
      while (g.level > 1) run(g, 40, 5);
    }
    expect(g.wait).toBe(GOVERNOR.maxWait);
  });
  it('a fall long after a climb is not a regret', () => {
    const g = new Governor(3, 1);
    run(g, 10, GOVERNOR.grace + GOVERNOR.wait + 2); // up to 2
    expect(g.level).toBe(2);
    run(g, (GOVERNOR.up + GOVERNOR.down) / 2, GOVERNOR.regret + 10); // a long stretch between "headroom" and "too slow": nothing changes
    expect(g.level).toBe(2);
    run(g, 40, 6);
    expect(g.level).toBe(1);
    expect(g.wait).toBe(GOVERNOR.wait);
  });
  it('lock fixes the level whatever the frame times say; unlock hands control back', () => {
    const g = new Governor();
    g.lock(1);
    expect(g.isLocked).toBe(true); expect(g.level).toBe(1);
    expect(run(g, 80, 60)).toEqual([]);
    expect(run(g, 5, 120)).toEqual([]);
    expect(g.level).toBe(1);
    g.lock(null);
    expect(g.isLocked).toBe(false);
    expect(run(g, 5, 60).map(c => c.level)).toEqual([2, 3]);
  });
  it('lock rounds and clamps its argument', () => {
    const g = new Governor();
    g.lock(99); expect(g.level).toBe(MAX_LEVEL);
    g.lock(-3); expect(g.level).toBe(0);
    g.lock(1.6); expect(g.level).toBe(2);
  });
  it('is deterministic: the same frames give the same levels', () => {
    const frames = Array.from({ length: 4000 }, (_, i) => 12 + 14 * Math.abs(Math.sin(i * .013)) + (i % 97 === 0 ? 40 : 0));
    const a = new Governor(), b = new Governor();
    expect(frames.map(f => a.sample(f))).toEqual(frames.map(f => b.sample(f)));
  });
});
