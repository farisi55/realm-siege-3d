// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app, hooks } from '../src/game/state';
import type { SndEv } from '../src/game/state';
import type { Unit } from '../src/game/types';
import { createWorld } from '../src/game/sim/world';
import { spawnCreep } from '../src/game/sim/units';
import { ui } from '../src/ui/store';
import type { HudSnap } from '../src/ui/store';
import { snd, playSFX } from '../src/audio/audio';
import { DEFAULT_VOLUME } from '../src/audio/AudioManager';
import { SOUNDS } from '../src/audio/synth';
import { resetCombatAudio, sndEvent } from '../src/audio/combat';
import { WORLD_SOUNDS, worldAudioReset, worldAudioTick } from '../src/audio/world';
import { FakeCtx } from './fake-audio';

/**
 * Phase 4: world audio. Every test drives the real world ticker against the real simulation state and records what the
 * engine was asked to play (`calls`) plus what actually entered the voice registry (`snd.count`). The fake context
 * never fires `onended`, so beds stay "live" until an explicit stop — restart logic is exercised with `stopAll()`.
 */

interface Call { bus: string; name: string; opts: { gain?: number; rate?: number; force?: boolean; pos?: { x: number; y: number } }; ok: boolean }

let calls: Call[] = [];

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeCtx);
  localStorage.clear();
  snd.dispose();
  snd.reset();
  snd.gesture();
  calls = [];
  const realPlay = snd.play.bind(snd);
  vi.spyOn(snd, 'play').mockImplementation((bus: any, name: any, opts: any = {}) => {
    const ok = realPlay(bus, name, opts);
    calls.push({ bus, name, opts, ok });
    return ok;
  });
  const realLoop = snd.startLoop.bind(snd);
  vi.spyOn(snd, 'startLoop').mockImplementation((bus: any, name: any, opts: any = {}) => {
    const h = realLoop(bus, name, opts);
    calls.push({ bus, name, opts, ok: !!h });
    return h;
  });
  worldAudioReset();
  resetCombatAudio();
  ui.set({ phase: 'play', paused: false, result: null, shop: false, scoreboard: false, hud: null, feed: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  hooks.snd = () => {};
  snd.stopAll();
  vi.unstubAllGlobals();
});

/** A fresh match already in the play phase. */
function startPlay(): Unit {
  app.mode = 'play';
  app.sel = 0;
  createWorld();
  app.G!.st = 'play';
  app.G!.nw = 1e9;
  return app.me;
}

/** Stands the hero (and the camera that listens) at one world point. */
function at(x: number, y: number): Unit {
  const me = app.me!;
  me.x = x; me.y = y;
  app.cam.k.x = x; app.cam.k.y = y;
  app.cam.cy = -.785; // the default isometric yaw, pinned so pan assertions stay deterministic
  return me;
}

const names = (): string[] => calls.map(c => c.name);
const steps = (name: string): Call[] => calls.filter(c => c.name === name);
/** Nudges a unit by (`dx`,`dy`) per frame and ticks the world, the way the simulation would have moved it. */
function walk(u: Unit, n: number, dx: number, dy: number): void {
  for (let i = 0; i < n; i++) { u.x += dx; u.y += dy; worldAudioTick(1 / 60); }
}

describe('footsteps', () => {
  it('follow real movement: one step per stride, cadence set by speed, silence when standing still', () => {
    startPlay();
    const me = at(2000, 1600); // grass
    worldAudioTick(1 / 60); // first sighting: no phantom step from the initial position
    expect(steps('stepGrass').length).toBe(0);

    walk(me, 60, 4, 0); // 240 units/s for one second: 240 / 62 stroll ≈ 3 steps
    const fast = steps('stepGrass').length;
    expect(fast).toBeGreaterThanOrEqual(3);
    expect(fast).toBeLessThanOrEqual(4);

    calls.length = 0;
    walk(me, 60, 2, 0); // half the speed: the same distance takes twice the time
    const slow = steps('stepGrass').length;
    expect(slow).toBeGreaterThanOrEqual(1);
    expect(slow).toBeLessThanOrEqual(2);

    calls.length = 0;
    walk(me, 60, 0, 0); // standing still: nothing
    expect(steps('stepGrass').length).toBe(0);
  });

  it('ticks differently in the river shallows than on grass', () => {
    startPlay();
    const me = at(1900, 1900); // |x - y| = 0: water
    walk(me, 40, 4, 0); // stays within |x - y| < 212 for all 40 ticks
    expect(steps('stepWater').length).toBeGreaterThanOrEqual(1);
    expect(steps('stepGrass').length).toBe(0);

    calls.length = 0;
    me.x = 2000; me.y = 1200; // a jump, then a walk on dry ground
    walk(me, 40, 4, 0);
    expect(steps('stepGrass').length).toBeGreaterThanOrEqual(1);
    expect(steps('stepWater').length).toBe(0);
  });

  it('never fires while dead or stunned, and never mistakes a dash for walking', () => {
    startPlay();
    const me = at(2000, 1600);
    walk(me, 40, 4, 0);
    const base = steps('stepGrass').length;
    expect(base).toBeGreaterThanOrEqual(1);

    me.dead = true;
    walk(me, 40, 4, 0);
    expect(steps('stepGrass').length).toBe(base); // dead men do not walk

    me.dead = false; me.st = 1; // stunned
    walk(me, 40, 4, 0);
    expect(steps('stepGrass').length).toBe(base);

    me.st = 0;
    const before = steps('stepGrass').length;
    me.x += 600; // a dash/blink: one enormous jump
    worldAudioTick(1 / 60);
    expect(steps('stepGrass').length).toBe(before); // no step for a teleport
  });

  it('keeps AI and creep footsteps low priority: near the listener only, quieter, budgeted', () => {
    startPlay();
    at(2700, 3000); // the player stands far away, perfectly still
    const creep = (() => { spawnCreep(1, 0, 'melee'); return app.all[app.all.length - 1]; })();
    creep.x = 1050; creep.y = 700; // on dry ground, near the camera
    app.cam.k.x = 1000; app.cam.k.y = 1000; // the camera watches the creep
    walk(creep, 40, 3, 0); // 120 units = one 74-unit creep stride

    const near = steps('stepGrass').filter(c => (c.opts.gain ?? 1) < .5);
    expect(near.length).toBeGreaterThanOrEqual(1);
    expect(steps('stepGrass').some(c => (c.opts.gain ?? 1) >= .9)).toBe(false); // the still player never stepped

    calls.length = 0;
    const far = (() => { spawnCreep(1, 0, 'melee'); return app.all[app.all.length - 1]; })();
    far.x = 2900; far.y = 2900; // ~2 700 units from the listener: out of earshot
    walk(far, 40, 3, 0);
    expect(calls.filter(c => c.name.startsWith('step')).length).toBe(0);
  });
});

describe('music', () => {
  it('plays one bed per scene and exactly one again after a restart', () => {
    app.mode = 'menu'; app.G = null;
    worldAudioTick(1 / 60);
    worldAudioTick(1 / 60);
    expect(snd.count('musicMenu')).toBe(1);
    expect(snd.count('ambWind')).toBe(0); // the menu has music, not the battlefield

    startPlay();
    worldAudioTick(1 / 60);
    expect(snd.count('musicMenu')).toBe(0);
    expect(snd.count('musicMatch')).toBe(1);
    worldAudioTick(1 / 60); // idempotent: never a second copy
    expect(snd.count('musicMatch')).toBe(1);

    snd.stopAll(); // what `flow.play()` runs on a match restart
    worldAudioTick(1 / 60);
    expect(snd.count('musicMatch')).toBe(1); // one bed again, never two
  });

  it('answers a finished match with the right stinger and silences the world', () => {
    startPlay();
    at(1600, 1600); // the map centre: the mid river emitter and all four camps are in earshot
    worldAudioTick(1 / 60);
    expect(snd.count('musicMatch')).toBe(1);
    expect(snd.count('ambWind')).toBe(1);
    expect(snd.count('ambForest')).toBe(4);
    expect(snd.count('ambRiver')).toBeGreaterThanOrEqual(1);
    expect(snd.spatialVoices().length).toBeGreaterThan(0);

    calls.length = 0;
    app.G!.over = true; app.G!.win = 0;
    worldAudioTick(1 / 60);
    worldAudioTick(1 / 60); // the stinger is a transition, not a per-frame call
    expect(names().filter(n => n === 'musicVictory').length).toBe(1);
    expect(snd.count('musicMatch')).toBe(0);
    expect(snd.count('ambWind')).toBe(0);
    expect(snd.count('ambRiver')).toBe(0);
    expect(snd.spatialVoices().length).toBe(0); // emitters cleaned up, not just silenced

    worldAudioReset();
    app.mode = 'play';
    app.sel = 0;
    createWorld();
    app.G!.st = 'play';
    app.G!.over = true; app.G!.win = 1;
    calls.length = 0;
    worldAudioTick(1 / 60);
    expect(names()).toContain('musicDefeat');
    expect(snd.count('musicMatch')).toBe(0);
  });
});

describe('spatial audio', () => {
  it('pans a source against the camera and follows a camera rotation', () => {
    snd.setListener(1000, 1000, 0); // right on screen = +x
    playSFX('stepGrass', { pos: { x: 1400, y: 1000 } });
    const east = () => snd.spatialVoices().find(v => v.name === 'stepGrass')!;
    expect(east().pan).toBeGreaterThan(.9);

    snd.setListener(1000, 1000, Math.PI / 2); // the camera turned: east is now dead ahead
    expect(Math.abs(east().pan)).toBeLessThan(.05);

    snd.setListener(1000, 1000, Math.PI); // half a turn: the same source is now on the left
    expect(east().pan).toBeLessThan(-.9);
  });

  it('attenuates with distance, culls beyond a def cutoff, and leaves un-referenced defs at full gain', () => {
    snd.setListener(1000, 1000, 0);
    expect(snd.attenuationAt('stepGrass', 1000, 1000)).toBeCloseTo(1, 5);
    const mid = snd.attenuationAt('stepGrass', 1300, 1000);
    const far = snd.attenuationAt('stepGrass', 1900, 1000);
    expect(mid).toBeLessThan(1);
    expect(far).toBeLessThan(mid);

    expect(playSFX('stepGrass', { pos: { x: 1300, y: 1000 } })).toBe(true);
    expect(snd.play('sfx', 'stepGrass', { pos: { x: 2100, y: 1000 } })).toBe(false); // beyond maxDist

    // Combat defs carry their own mix gain: positional panning, no engine falloff on top.
    expect(snd.play('sfx', 'swing', { pos: { x: 1400, y: 1000 } })).toBe(true);
    const swing = snd.spatialVoices().find(v => v.name === 'swing')!;
    expect(swing.pan).toBeGreaterThan(.9);
    expect(swing.gain).toBeCloseTo(1, 5);
    expect(snd.attenuationAt('swing', 2000, 2000)).toBe(1);
  });

  it('keeps sustained emitters tied to their world point as the camera moves', () => {
    startPlay();
    at(1600, 1600); // the river point sits exactly under the camera
    worldAudioTick(1 / 60);
    const river = () => snd.spatialVoices().find(v => v.name === 'ambRiver')!;
    expect(river().gain).toBeCloseTo(1, 2); // lay the camera on the river: no distance loss
    expect(Math.abs(river().pan)).toBeLessThan(.05);

    app.cam.k.y = 600; // the camera moved 1 000 units away from the water
    worldAudioTick(1 / 60);
    expect(river().gain).toBeLessThan(.3);
    expect(snd.attenuationAt('ambRiver', 1600, 1600)).toBeCloseTo(1 / (1 + (1000 / 460) ** 2), 2);

    app.cam.k.x = 2000; app.cam.k.y = 1600; // now it stands beside the same river point
    worldAudioTick(1 / 60);
    expect(river().pan).toBeLessThan(-.5); // the source is west of the camera
  });

  it('turns heavy blasts outside the view into a restrained distant rumble, never a full voice', () => {
    startPlay();
    const me = at(2700, 3000);
    worldAudioTick(1 / 60);

    calls.length = 0;
    sndEvent({ k: 'hit', x: me.x + 2600, y: me.y, team: 1, kind: 'blast' } as SndEv);
    expect(names()).toContain('ambDistant');
    expect(names()).not.toContain('boomBlast'); // 2 600 > its 1 800 range: the distant layer replaces it
    const distant = calls.find(c => c.name === 'ambDistant')!;
    expect(distant.opts.gain ?? 1).toBeLessThanOrEqual(.6);

    sndEvent({ k: 'hit', x: me.x + 2600, y: me.y, team: 1, kind: 'melee' } as SndEv); // only blasts light the rumble
    expect(names().filter(n => n === 'ambDistant').length).toBe(1);

    sndEvent({ k: 'hit', x: me.x + 300, y: me.y, team: 1, kind: 'blast' } as SndEv); // in view: the real thing
    expect(names()).toContain('boomBlast');
    expect(names().filter(n => n === 'ambDistant').length).toBe(1);
  });
});

describe('lifecycle', () => {
  it('ducks the gameplay buses while paused and restores them on resume', () => {
    startPlay();
    worldAudioTick(1 / 60);
    expect(snd.levels().music).toBeCloseTo(DEFAULT_VOLUME.music, 5);

    app.G!.pause = true;
    worldAudioTick(1 / 60);
    const paused = snd.levels();
    expect(paused.music).toBeCloseTo(DEFAULT_VOLUME.music * .25, 5);
    expect(paused.sfx).toBeCloseTo(DEFAULT_VOLUME.sfx * .25, 5);
    expect(paused.ambient).toBeCloseTo(DEFAULT_VOLUME.ambient * .25, 5);
    expect(paused.ui).toBeCloseTo(DEFAULT_VOLUME.ui, 5); // controls stay crisp

    app.G!.pause = false;
    worldAudioTick(1 / 60);
    expect(snd.levels().music).toBeCloseTo(DEFAULT_VOLUME.music, 5);
  });

  it('announces level-ups and reward-sized gold gains from the HUD snapshot (never the passive drip), and stays quiet on a new match', () => {
    startPlay();
    const snap = (lv: number, gold: number, time: number): HudSnap => ({
      hero: 0, lv, hp: 1, max: 1, mp: 1, mmax: 1, xp: 0, xpNext: 1, gold, cds: [0, 0, 0, 0],
      items: [null, null, null, null, null, null], kills: [0, 0], time, towers: [3, 3], countdown: '', score: null,
    });
    ui.set({ hud: snap(1, 600, 1) });
    worldAudioTick(1 / 60); // adopting the running match: silent
    expect(names()).not.toContain('uiGold');

    ui.set({ hud: snap(2, 600, 1.1) });
    worldAudioTick(1 / 60);
    expect(names()).toContain('uiLevel');

    ui.set({ hud: snap(2, 700, 1.2) });
    worldAudioTick(1 / 60);
    expect(names()).toContain('uiGold');

    calls.length = 0;
    // The passive income line crosses a whole number every ~0.4 s; a coin or three per snapshot is bookkeeping, not a reward.
    ui.set({ hud: snap(2, 701, 1.3) });
    worldAudioTick(1 / 60);
    ui.set({ hud: snap(2, 702, 1.4) });
    worldAudioTick(1 / 60);
    ui.set({ hud: snap(2, 704, 1.5) });
    worldAudioTick(1 / 60);
    expect(names()).not.toContain('uiGold');

    ui.set({ hud: snap(2, 726, 1.6) }); // a creep bounty: delta 22, the smallest real reward in the game
    worldAudioTick(1 / 60);
    expect(names()).toContain('uiGold');

    calls.length = 0;
    ui.set({ hud: snap(1, 600, .1) }); // a fresh match: yesterday's numbers are not announced
    worldAudioTick(1 / 60);
    expect(names()).not.toContain('uiGold');
    expect(names()).not.toContain('uiLevel');
  });

  it('defines every phase-4 voice in the manifest and leaves no loop or emitter behind after a reset', () => {
    for (const n of WORLD_SOUNDS) expect(SOUNDS[n], `missing definition: ${n}`).toBeTruthy();

    startPlay();
    worldAudioTick(1 / 60);
    expect(snd.count('musicMatch')).toBe(1);
    expect(snd.count('ambWind')).toBe(1);

    worldAudioReset();
    expect(snd.count('musicMatch')).toBe(0);
    expect(snd.count('ambWind')).toBe(0);
    expect(snd.count('ambRiver')).toBe(0);
    expect(snd.spatialVoices().length).toBe(0);
    expect(snd.duck).toBe(1);
  });
});
