// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app, hooks } from '../src/game/state';
import type { SndEv } from '../src/game/state';
import type { Unit } from '../src/game/types';
import { createWorld, stepSim } from '../src/game/sim/world';
import { spawnCreep } from '../src/game/sim/units';
import { cast, hurt } from '../src/game/sim/combat';
import { snd } from '../src/audio/audio';
import { SOUNDS } from '../src/audio/synth';
import { resetCombatAudio, sndEvent } from '../src/audio/combat';
import { FakeCtx } from './fake-audio';

/**
 * Phase 2: the combat mappings, verified against the real simulation. Each test drives `createWorld`/`stepSim` and the
 * real combat functions, recording two levels:
 *   events — what the simulation reported through `hooks.snd` (one per meaningful moment)
 *   calls  — what the audio layer asked the engine to play, and whether the engine started it (`ok`)
 * The fake Web Audio context never fires `onended`, so the voice registry saturates in long tests; those assert the
 * *attempt* (the mapping), while short tests also assert `ok`.
 */

interface Call { bus: string; name: string; opts: { gain?: number; rate?: number; force?: boolean }; ok: boolean }
interface Rec { e: SndEv; t: number }

let calls: Call[] = [];
let events: Rec[] = [];

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeCtx);
  localStorage.clear();
  snd.dispose(); // fresh graph, voices, minGaps and noise for every test
  snd.gesture(); // the first user click already happened; the FakeCtx starts running
  calls = []; events = [];
  const real = snd.play.bind(snd);
  vi.spyOn(snd, 'play').mockImplementation((bus: any, name: any, opts: any = {}) => {
    const ok = real(bus, name, opts);
    calls.push({ bus, name, opts, ok });
    return ok;
  });
  hooks.snd = e => { events.push({ e: { ...e }, t: app.G ? app.G.t : -1 }); sndEvent(e); };
  resetCombatAudio();
});

afterEach(() => {
  vi.restoreAllMocks();
  hooks.snd = () => {};
  hooks.finish = () => {};
  snd.stopAll();
  vi.unstubAllGlobals();
});

/** A fresh match already in the play phase; `waves` optionally lets the wave scheduler run from t = 0. */
function startPlay(sel = 0, waves = false): void {
  app.sel = sel;
  createWorld();
  app.G!.st = 'play';
  app.G!.nw = waves ? app.G!.t : 1e9;
}
const step = (n: number): void => { for (let i = 0; i < n; i++) stepSim(1 / 60); };
const names = (): string[] => calls.map(c => c.name);
const lastUnit = (): Unit => app.all[app.all.length - 1];
const lastCall = (): Call => calls[calls.length - 1];

/** Moves the duel to an empty corner (no lanes, camps or structures in reach) and stands the rest of the blue team aside. */
function clearArena(): void {
  const me = app.me;
  me.x = 2700; me.y = 3000;
  for (const u of app.all) {
    if (u === me) continue;
    if (u.k === 'hero' && u.team === 0) { u.ai = false; u.cd = 1e9; u.x = 150; u.y = 150; }
    if ((u.k === 'tower' || u.k === 'core') && u.team === 0) u.cd = 1e9;
  }
}

// ---------------------------------------------------------------------------------------------------------------- event mapping

describe('combat audio: simulation events map to sounds through real gameplay', () => {
  it('melee: swing on windup, impact only when the blow actually lands (220 ms later)', () => {
    startPlay(0); // Arcane Knight: melee, rng 120
    clearArena();
    const me = app.me;
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.x = me.x + 80; foe.y = me.y;
    step(1); // the hero auto-attacks the creep standing in range
    const swing = events.find(r => r.e.k === 'swing' && r.e.player);
    expect(swing).toBeTruthy();
    expect(swing!.e.kind).toBe('hero');
    expect(events.some(r => r.e.k === 'hit')).toBe(false); // no impact sound before the strike lands
    step(20);
    const hit = events.find(r => r.e.k === 'hit' && r.e.kind === 'melee');
    expect(hit).toBeTruthy();
    expect(hit!.t - swing!.t).toBeGreaterThanOrEqual(.2); // the impact follows the wind-up schedule
    expect(hit!.t - swing!.t).toBeLessThan(.3);
    expect(foe.hp).toBeLessThan(foe.max);
    expect(names()).toContain('swing');
    expect(names()).toContain('hitMelee');
  });

  it('ranged: no swing, a launch at release, an arrow impact when the projectile reaches the foe', () => {
    startPlay(1); // Shadow Huntress: rng 380
    clearArena();
    const me = app.me;
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.x = me.x + 300; foe.y = me.y;
    step(60); // 1 s: 220 ms windup + the homing arrow's flight
    expect(events.every(r => !(r.e.k === 'swing' && r.e.player))).toBe(true); // bows do not swing
    const launch = events.find(r => r.e.k === 'launch' && r.e.player);
    expect(launch).toBeTruthy();
    expect(launch!.e.kind).toBe('arrow');
    const hit = events.find(r => r.e.k === 'hit' && r.e.kind === 'arrow');
    expect(hit).toBeTruthy();
    expect(hit!.t).toBeGreaterThan(launch!.t); // the impact came after the projectile existed
    expect(foe.hp).toBeLessThan(foe.max);
    expect(names()).toContain('bowShot');
    expect(names()).toContain('hitArrow');
  });

  it('ability bolt: a magic launch at cast, a magic impact on the first enemy it reaches', () => {
    startPlay(0);
    clearArena();
    const me = app.me;
    me.mp = 999; me.acd[0] = 0;
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.x = me.x + 260; foe.y = me.y;
    cast(me, 0, foe.x, foe.y); // Arcane Strike: ballistic bolt
    step(60);
    expect(events.some(r => r.e.k === 'launch' && r.e.kind === 'magic' && r.e.player)).toBe(true);
    expect(events.some(r => r.e.k === 'hit' && r.e.kind === 'magic')).toBe(true);
    expect(foe.hp).toBeLessThan(foe.max);
    expect(names()).toContain('magicShot');
    expect(names()).toContain('hitMagic');
  });

  it('towers: a heavy launch when the tower fires, a heavy impact when its bolt lands', () => {
    startPlay(0);
    const tw = app.all.find(u => u.k === 'tower' && u.team === 0) as Unit;
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.x = tw.x + 260; foe.y = tw.y; // inside the tower's 400 range
    step(90); // 1.5 s: windup + bolt flight
    const launch = events.find(r => r.e.k === 'launch' && r.e.kind === 'heavy');
    expect(launch).toBeTruthy();
    const hit = events.find(r => r.e.k === 'hit' && r.e.kind === 'heavy');
    expect(hit).toBeTruthy();
    expect(hit!.t).toBeGreaterThan(launch!.t);
    expect(foe.hp).toBeLessThan(foe.max);
    expect(names()).toContain('siegeShot');
    expect(names()).toContain('hitHeavy');
  });

  it('damage feedback and death: the killing blow emits exactly one death event → dieCreep', () => {
    startPlay(0);
    clearArena();
    const me = app.me;
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.x = me.x + 80; foe.y = me.y;
    foe.hp = 1;
    step(20);
    const dies = events.filter(r => r.e.k === 'die' && r.e.player);
    expect(dies.length).toBe(1); // one event per meaningful moment: no double death sound
    const call = calls.find(c => c.name === 'dieCreep');
    expect(call).toBeTruthy();
    expect(call!.ok).toBe(true);
  });

  it('tower destruction: exactly one death event, one forced structural collapse', () => {
    startPlay(0);
    const tw = app.all.find(u => u.k === 'tower' && u.team === 1) as Unit;
    hurt(app.me, tw, 1e6);
    const dies = events.filter(r => r.e.k === 'die' && r.e.kind === 'tower');
    expect(dies.length).toBe(1);
    expect(dies[0].e.big).toBe(true);
    const call = calls.find(c => c.name === 'collapseTower');
    expect(call).toBeTruthy();
    expect(call!.ok).toBe(true);
    expect(call!.opts.force).toBe(true);
  });

  it('core: damage tolls hitCore; destruction plays coreCollapse and still ends the match', () => {
    startPlay(0);
    const core = app.all.find(u => u.k === 'core' && u.team === 1) as Unit;
    let winner = -1;
    hooks.finish = w => { winner = w; };
    hurt(app.me, core, 100);
    expect(events.some(r => r.e.k === 'hit' && r.e.kind === 'core')).toBe(true);
    expect(names()).toContain('hitCore');
    hurt(app.me, core, 1e9);
    expect(events.filter(r => r.e.k === 'die' && r.e.kind === 'core').length).toBe(1);
    expect(winner).toBe(0); // the existing victory path is untouched
    const call = calls.find(c => c.name === 'coreCollapse');
    expect(call).toBeTruthy();
    expect(call!.ok).toBe(true);
    expect(call!.opts.force).toBe(true);
  });

  it('area damage: one blast voice for many victims, silence per victim', () => {
    startPlay(0); // Ground Slam is ability index 2 (aoe)
    clearArena();
    const me = app.me;
    me.mp = 999; me.acd[2] = 0;
    const victims = [-40, 30, 60].map((dy, i) => {
      spawnCreep(1, 0, 'ranged');
      const c = lastUnit();
      c.x = me.x + 185 + i * 10; c.y = me.y + dy; // inside the 230-radius slam, outside the hero's 160 reach
      return c;
    });
    cast(me, 2, me.x, me.y);
    step(20);
    const blasts = events.filter(r => r.e.k === 'hit' && r.e.kind === 'blast');
    expect(blasts.length).toBe(1); // one boom per blast, no matter how many units it hits
    expect(victims.every(v => v.hp < v.max)).toBe(true); // the damage really went through the hurt() path
    expect(events.filter(r => r.t === blasts[0].t && r.e.k === 'hit' && r.e.kind !== 'blast').length).toBe(0);
    expect(names()).toContain('boomBlast');
  });

  it('hero death and respawn: dieBig on the fall, one respawn chime when the timer ends', () => {
    startPlay(0);
    const me = app.me;
    const foe = app.all.find(u => u.k === 'hero' && u.team === 1) as Unit;
    hurt(foe, me, 1e6); // the real damage path: the player's hero falls
    expect(events.some(r => r.e.k === 'die' && r.e.kind === 'hero' && r.e.player)).toBe(true);
    expect(names()).toContain('dieBig');
    step(500); // ~8.3 s: the level-1 respawn countdown (6 + lv*2)
    const re = events.filter(r => r.e.k === 'respawn' && r.e.player);
    expect(re.length).toBe(1);
    expect(me.dead).toBe(false);
    expect(Math.round(me.x)).toBe(470); // back at the team spawn
    const call = calls.find(c => c.name === 'respawn');
    expect(call).toBeTruthy();
    expect(call!.opts.force).toBe(true);
  });

  it('every event the simulation can emit maps onto an existing sound definition', () => {
    startPlay(0);
    const { x, y } = app.me;
    const samples: SndEv[] = [
      { k: 'swing', x, y, team: 0, kind: 'hero' },
      { k: 'launch', x, y, team: 0, kind: 'arrow' },
      { k: 'launch', x, y, team: 0, kind: 'heavy' },
      { k: 'launch', x, y, team: 0, kind: 'magic' },
      { k: 'hit', x, y, team: 0, kind: 'melee' },
      { k: 'hit', x, y, team: 0, kind: 'arrow' },
      { k: 'hit', x, y, team: 0, kind: 'magic' },
      { k: 'hit', x, y, team: 0, kind: 'heavy' },
      { k: 'hit', x, y, team: 0, kind: 'structure' },
      { k: 'hit', x, y, team: 0, kind: 'core' },
      { k: 'hit', x, y, team: 0, kind: 'blast' },
      { k: 'die', x, y, team: 0, kind: 'melee' },
      { k: 'die', x, y, team: 0, kind: 'hero' },
      { k: 'die', x, y, team: 0, kind: 'tower' },
      { k: 'die', x, y, team: 0, kind: 'core' },
      { k: 'respawn', x, y, team: 0, kind: 'hero' },
    ];
    for (const e of samples) { resetCombatAudio(); sndEvent(e); }
    const used = new Set(names());
    expect(used.size).toBe(16); // every kind of event found its own voice
    for (const n of used) expect(SOUNDS[n], `missing sound definition: ${n}`).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------------- mix policy

describe('combat audio policy: attenuation, throttling, priority, variation', () => {
  it('keeps distant fights silent and quietens mid-range impacts', () => {
    startPlay(0);
    const me = app.me;
    sndEvent({ k: 'hit', x: me.x + 2000, y: me.y, team: 1, kind: 'melee' });
    expect(calls.length).toBe(0); // beyond the melee impact range: the fight near the hero keeps the mix
    sndEvent({ k: 'hit', x: me.x + 300, y: me.y, team: 1, kind: 'melee' });
    const near = lastCall();
    resetCombatAudio();
    sndEvent({ k: 'hit', x: me.x + 1000, y: me.y, team: 1, kind: 'melee' });
    const far = lastCall();
    expect(near.name).toBe('hitMelee');
    expect(far.name).toBe('hitMelee');
    expect(far.opts.gain!).toBeLessThan(near.opts.gain!);
  });

  it('caps a swarm: a burst of simultaneous impacts produces a bounded number of voices', () => {
    startPlay(0);
    const me = app.me;
    for (let i = 0; i < 12; i++) sndEvent({ k: 'hit', x: me.x + 60 + i * 3, y: me.y, team: 1, kind: 'melee' });
    expect(calls.length).toBe(5); // the rolling budget let five through…
    const played = calls.filter(c => c.ok).length;
    expect(played).toBeGreaterThanOrEqual(1);
    expect(played).toBeLessThanOrEqual(2); // …and the engine's minGap collapsed the duplicates
  });

  it("priorities: the player's own hits bypass the budget and play forced with a gain lift", () => {
    startPlay(0);
    const me = app.me;
    sndEvent({ k: 'hit', x: me.x + 60, y: me.y, team: 1, kind: 'melee' });
    const neutral = lastCall();
    resetCombatAudio();
    sndEvent({ k: 'hit', x: me.x + 60, y: me.y, team: 0, kind: 'melee', player: true });
    const own = lastCall();
    expect(own.opts.force).toBe(true); // skips minGap and per-sound caps
    expect(neutral.opts.force).toBe(false);
    expect(own.ok).toBe(true); // heard even though a duplicate just played
    expect(own.opts.gain!).toBeGreaterThan(neutral.opts.gain!);
  });

  it('varies pitch between repetitions so one event never sounds stamped', () => {
    startPlay(0);
    const me = app.me;
    for (let i = 0; i < 5; i++) { resetCombatAudio(); sndEvent({ k: 'hit', x: me.x + 100, y: me.y, team: 1, kind: 'melee' }); }
    const rates = calls.map(c => c.opts.rate!);
    expect(rates.every(r => r >= .93 && r <= 1.07)).toBe(true);
    expect(new Set(rates).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------- autonomous battle

describe('combat audio: a full autonomous battle', () => {
  it('exercises the combat vocabulary through real events over 100 s of simulation', { timeout: 60000 }, () => {
    startPlay(0, true); // waves spawn from t = 0; both teams' AI heroes fight, towers return fire
    step(6000);
    const used = names();
    // The names every measured battle produced reliably; seed-dependent ones (hitMelee, dieCreep, collapseTower near the
    // idle player) are already pinned to real events by the controlled tests above.
    for (const n of ['swing', 'bowShot', 'siegeShot', 'magicShot', 'hitArrow', 'hitMagic', 'hitStructure', 'hitHeavy', 'boomBlast', 'dieBig', 'respawn']) {
      expect(used, `no ${n} over 100 s of battle`).toContain(n);
    }
    expect(events.length).toBeGreaterThan(300); // and the events were real: thousands of moments, not a mock
    expect(calls.length).toBeGreaterThan(100); // the player's corner always hears some of the battle…
    expect(calls.length).toBeLessThan(events.length / 3); // …but the mix plays only what happens nearby, never everything
  });
});
