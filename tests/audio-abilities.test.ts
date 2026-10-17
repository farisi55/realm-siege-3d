// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { app, hooks } from '../src/game/state';
import type { SndEv } from '../src/game/state';
import type { Unit } from '../src/game/types';
import { createWorld, stepSim } from '../src/game/sim/world';
import { rc, spawnCreep } from '../src/game/sim/units';
import { cast, hurt } from '../src/game/sim/combat';
import { snd, setVolume, stopAll } from '../src/audio/audio';
import { SOUNDS } from '../src/audio/synth';
import { resetCombatAudio, sndEvent } from '../src/audio/combat';
import { abilitySoundNames, activeAbilityLoops } from '../src/audio/abilities';
import { FakeCtx } from './fake-audio';

/**
 * Phase 3: hero and ability audio, verified against the real simulation. Every test drives `createWorld`/`stepSim` and
 * the real `cast()`/`hurt()` paths, recording two levels (the phase-2 pattern):
 *   events — what the simulation reported through `hooks.snd` (one per meaningful moment, `ab` = hero * 4 + slot)
 *   calls  — what the audio layer asked the engine to play (one-shots and loop starts), and whether it started
 * All 20 abilities are exercised via the real cast path (level 3, full mana); the fake context never fires `onended`,
 * so voice-registry assertions use explicit stops (loops) or play attempts (one-shots).
 */

interface Call { bus: string; name: string; opts: { gain?: number; rate?: number; force?: boolean }; ok: boolean }
interface Rec { e: SndEv; t: number }

let calls: Call[] = [];
let events: Rec[] = [];

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeCtx);
  localStorage.clear();
  snd.dispose();
  snd.gesture();
  calls = []; events = [];
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

/** Moves the hero duel to an empty corner and stands the rest of the blue team aside (phase-2 harness). */
function clearArena(): void {
  const me = app.me;
  me.x = 2700; me.y = 3000;
  for (const u of app.all) {
    if (u === me) continue;
    if (u.k === 'hero' && u.team === 0) { u.ai = false; u.cd = 1e9; u.x = 150; u.y = 150; }
    if ((u.k === 'tower' || u.k === 'core') && u.team === 0) u.cd = 1e9;
  }
}

const killCreeps = (): void => { for (const u of app.all) if (u.k === 'creep') u.dead = true; };

/** Fresh world in the quiet arena with the player's hero at level 3 (ultimates unlocked). */
function prep(h: number): Unit {
  startPlay(h);
  clearArena();
  const me = app.me!;
  me.lv = 3; rc(me, 1);
  return me;
}

const A = (h: number, i: number): number => h * 4 + i;

/** The voices each ability must produce when driven through the real simulation (the design table). */
const EXP: Record<number, string[]> = {
  [A(0, 0)]: ['akStrikeCharge', 'akStrike', 'akStrikeHit'],
  [A(0, 1)]: ['akShield', 'healPulse'],
  [A(0, 2)]: ['akSlamWind', 'akSlamImpact'],
  [A(0, 3)]: ['akMeteorBuild', 'akMeteorImpact'],
  [A(1, 0)]: ['shDash'],
  [A(1, 1)]: ['shPoison', 'shPoisonHit'],
  [A(1, 2)]: ['shVeil'],
  [A(1, 3)]: ['shMark', 'shMarkBurst'],
  [A(2, 0)]: ['emFireCharge', 'emFireCast', 'emFireHit'],
  [A(2, 1)]: ['emWave'],
  [A(2, 2)]: ['emZone', 'emZoneFire'],
  [A(2, 3)]: ['emStormBuild', 'emStormImpact'],
  [A(3, 0)]: ['ngSeed', 'healPulse'],
  [A(3, 1)]: ['ngRoot'],
  [A(3, 2)]: ['ngBarrier', 'healPulse'],
  [A(3, 3)]: ['ngRebirthBuild', 'ngRebirthPulse'],
  [A(4, 0)]: ['swPunch', 'swPunchHit'],
  [A(4, 1)]: ['swField'],
  [A(4, 2)]: ['swCharge', 'swChargeHit'],
  [A(4, 3)]: ['swRage'],
};

/** The single voice that identifies each ability in the mix (all 20 must be distinct). */
const PRIMARY: Record<number, string> = {
  [A(0, 0)]: 'akStrike', [A(0, 1)]: 'akShield', [A(0, 2)]: 'akSlamImpact', [A(0, 3)]: 'akMeteorImpact',
  [A(1, 0)]: 'shDash', [A(1, 1)]: 'shPoison', [A(1, 2)]: 'shVeil', [A(1, 3)]: 'shMarkBurst',
  [A(2, 0)]: 'emFireCast', [A(2, 1)]: 'emWave', [A(2, 2)]: 'emZoneFire', [A(2, 3)]: 'emStormImpact',
  [A(3, 0)]: 'ngSeed', [A(3, 1)]: 'ngRoot', [A(3, 2)]: 'ngBarrier', [A(3, 3)]: 'ngRebirthPulse',
  [A(4, 0)]: 'swPunch', [A(4, 1)]: 'swField', [A(4, 2)]: 'swChargeHit', [A(4, 3)]: 'swRage',
};

/** Fires one slot through the real cast path (mana, cooldown, target per ability type) and returns only its voices. */
function fire(me: Unit, i: number): string[] {
  killCreeps();
  const a = me.def.ab[i], T = a[2];
  me.mp = 9999; me.acd[i] = 0;
  calls.length = 0; events.length = 0;
  if (T === 'bolt') {
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.max = foe.hp = 5000; // survives the bolt: the impact is tested, not a kill sound
    foe.x = me.x + Math.min(a[6] - 40, 320); foe.y = me.y;
    cast(me, i, foe.x, foe.y);
    step(60);
  } else if (T === 'heal') {
    me.hp = me.max * .4; // wounded: the heal must really restore health to be heard
    cast(me, i, me.x, me.y);
    step(30);
  } else {
    cast(me, i, me.x + 200, me.y);
    step(30);
  }
  return names();
}

// ---------------------------------------------------------------------------------------------------------------- mapping

describe('ability audio: every hero skill maps to its own voices through real gameplay', () => {
  it('every distinct design voice of Q/W/E/R across the five heroes is exercised', () => {
    const seen = new Set<string>();
    for (let h = 0; h < 5; h++) {
      const me = prep(h);
      for (let i = 0; i < 4; i++) {
        const got = fire(me, i);
        for (const want of EXP[A(h, i)]) expect(got, `hero ${h} slot ${i}: missing ${want}`).toContain(want);
        expect(got.length, `hero ${h} slot ${i}: silent skill`).toBeGreaterThan(0);
        for (const n of EXP[A(h, i)]) seen.add(n);
      }
    }
    expect(seen.size).toBe(new Set(abilitySoundNames()).size); // every designed voice was really exercised
  });

  it('identities are distinct and every ability voice exists in the manifest', () => {
    for (const n of abilitySoundNames()) expect(SOUNDS[n], `missing sound definition: ${n}`).toBeTruthy();
    expect(new Set(Object.values(PRIMARY)).size).toBe(20); // no two skills share a signature voice
    expect(SOUNDS.emZoneFire.loop).toBe(true); // the one sustained voice declares itself
  });

  it('cast and impact timings match the simulation clock', () => {
    const me = prep(0); // Ground Slam (aoe) executes at exactly +250 ms
    me.mp = 9999; me.acd[2] = 0;
    cast(me, 2, me.x, me.y);
    step(30);
    const castEv = events.find(r => r.e.k === 'cast' && r.e.ab === A(0, 2))!;
    const hitEv = events.find(r => r.e.k === 'hit' && r.e.kind === 'blast' && r.e.ab === A(0, 2))!;
    expect(castEv).toBeTruthy();
    expect(hitEv).toBeTruthy();
    expect(hitEv.t - castEv.t).toBeGreaterThanOrEqual(.24);
    expect(hitEv.t - castEv.t).toBeLessThanOrEqual(.27);

    const me2 = prep(2); // Fire Bolt releases at +250 ms, then really flies
    me2.mp = 9999; me2.acd[0] = 0;
    spawnCreep(1, 0, 'melee');
    const foe = lastUnit();
    foe.x = me2.x + 320; foe.y = me2.y;
    cast(me2, 0, foe.x, foe.y);
    step(60);
    const c2 = events.find(r => r.e.k === 'cast' && r.e.ab === A(2, 0))!;
    const l2 = events.find(r => r.e.k === 'launch' && r.e.ab === A(2, 0))!;
    const h2 = events.find(r => r.e.k === 'hit' && r.e.kind === 'magic' && r.e.ab === A(2, 0))!;
    expect(c2 && l2 && h2).toBeTruthy();
    expect(l2.t - c2.t).toBeGreaterThanOrEqual(.24);
    expect(l2.t - c2.t).toBeLessThanOrEqual(.27);
    expect(h2.t - l2.t).toBeGreaterThan(.3); // the impact follows real flight time, never the cast
    expect(names()).toContain('emFireHit');
  });

  it('failed or cancelled casts stay silent: no wind-up, no false impact', () => {
    const me = prep(2);
    me.mp = 0; me.acd[0] = 0;
    cast(me, 0, me.x + 200, me.y); // no mana
    expect(events.length).toBe(0);
    me.mp = 9999; me.acd[0] = 5;
    cast(me, 0, me.x + 200, me.y); // on cooldown
    expect(events.length).toBe(0);
    me.lv = 1; rc(me, 1); me.mp = 9999; me.acd[3] = 0;
    cast(me, 3, me.x + 200, me.y); // R locked below level 3
    expect(events.length).toBe(0);
    // Killed during the 250 ms wind-up: the cast committed, the storm never arrives.
    me.lv = 3; rc(me, 1); me.mp = 9999; me.acd[3] = 0;
    cast(me, 3, me.x + 200, me.y);
    const foe = app.all.find(u => u.k === 'hero' && u.team === 1) as Unit;
    hurt(foe, me, 1e6);
    step(30);
    expect(events.filter(r => r.e.k === 'cast').length).toBe(1);
    // The death blow's own `hit` event is not an ability impact: only `ab`-carrying events count here.
    expect(events.some(r => (r.e.k === 'launch' || r.e.k === 'hit' || r.e.k === 'heal') && r.e.ab !== undefined)).toBe(false);
    expect(names()).not.toContain('emStormImpact');
  });

  it('a committed cast cannot double-fire', () => {
    const me = prep(0);
    me.mp = 9999; me.acd[0] = 0;
    cast(me, 0, me.x + 200, me.y);
    cast(me, 0, me.x + 200, me.y); // same tick: the cooldown set by the first cast blocks the second
    expect(events.filter(r => r.e.k === 'cast').length).toBe(1);
    expect(names()).toEqual(['akStrikeCharge']);
  });

  it('healing sounds differ from damage sounds and only play for real healing', () => {
    const me = prep(3); // Nature Guardian: W is damage, Q is the heal
    const dmg = fire(me, 1);
    expect(dmg).toContain('ngRoot');
    expect(dmg).not.toContain('healPulse');
    me.hp = me.max; me.mp = 9999; me.acd[0] = 0;
    calls.length = 0; events.length = 0;
    cast(me, 0, me.x, me.y); // at full health nothing is restored: no confirmation, no false positive
    step(30);
    expect(events.some(r => r.e.k === 'heal')).toBe(false);
    expect(names()).not.toContain('healPulse');
    me.hp = me.max * .3; me.mp = 9999; me.acd[0] = 0;
    calls.length = 0; events.length = 0;
    cast(me, 0, me.x, me.y);
    step(30);
    expect(events.some(r => r.e.k === 'heal' && r.e.ab === A(3, 0))).toBe(true);
    expect(names()).toContain('healPulse');
    expect(names().every(n => n === 'ngSeed' || n === 'healPulse')).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------------------------ loops

describe('ability audio: sustained voices obey their owner and the match lifecycle', () => {
  it('the Burning Zone fire bed starts on ignition and dies with its caster', () => {
    const me = prep(2);
    me.mp = 9999; me.acd[2] = 0;
    cast(me, 2, me.x + 150, me.y);
    step(30);
    expect(activeAbilityLoops()).toBe(1);
    expect(snd.count('emZoneFire')).toBe(1);
    const foe = app.all.find(u => u.k === 'hero' && u.team === 1) as Unit;
    hurt(foe, me, 1e6); // the caster falls: the die event takes the loop down
    expect(activeAbilityLoops()).toBe(0);
    expect(snd.count('emZoneFire')).toBe(0);
  });

  it('a match restart leaves no loop behind (resetCombatAudio + stopAll, as flow.play runs)', () => {
    const me = prep(2);
    me.mp = 9999; me.acd[2] = 0;
    cast(me, 2, me.x + 150, me.y);
    step(30);
    expect(snd.count('emZoneFire')).toBe(1);
    resetCombatAudio();
    stopAll(); // exactly what flow.play() runs before every fresh match
    expect(activeAbilityLoops()).toBe(0);
    expect(snd.count('emZoneFire')).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------- battle

describe('ability audio: a full autonomous battle', () => {
  it('exercises the ability vocabulary through real AI casts over 100 s of simulation', { timeout: 60000 }, () => {
    startPlay(0, true); // waves spawn from t = 0; both teams' AI heroes fight and cast their real kits
    for (const u of app.all) if (u.k === 'hero') u.lv = 3; // unlock ultimates: the battle fights a full kit
    step(6000);
    const used = names();
    // The common-cast voices every measured battle produced reliably across runs, covering all five hero families;
    // seed-dependent ones (swPunch, shMark, shVeil, akStrike) are pinned to real events by the controlled tests above.
    for (const n of [
      'emFireCharge', 'emFireCast', 'emFireHit', 'emWave', 'emZone', 'emZoneFire',
      'shDash', 'shPoison', 'shPoisonHit',
      'ngSeed', 'ngBarrier', 'ngRoot', 'healPulse',
      'swField', 'swCharge', 'swChargeHit',
    ]) expect(used, `no ${n} over 100 s of battle`).toContain(n);
    // At least one ultimate fired — which one depends on the fight, so the set (not a single name) is asserted.
    const ults = ['akMeteorBuild', 'akMeteorImpact', 'shMark', 'shMarkBurst', 'emStormBuild', 'emStormImpact', 'ngRebirthBuild', 'ngRebirthPulse', 'swRage'];
    expect(ults.some(n => used.includes(n)), 'no ultimate fired in the battle').toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------- policy

describe('ability audio: volume controls and the mix policy still hold', () => {
  it('the sfx bus at zero silences ability voices; restoring it brings them back', () => {
    const me = prep(0);
    me.mp = 9999; me.acd[0] = 0;
    setVolume('sfx', 0);
    cast(me, 0, me.x + 200, me.y);
    expect(calls[calls.length - 1].ok).toBe(false);
    setVolume('sfx', 1);
    resetCombatAudio();
    me.mp = 9999; me.acd[0] = 0;
    cast(me, 0, me.x + 200, me.y);
    expect(calls[calls.length - 1].ok).toBe(true);
  });
});
