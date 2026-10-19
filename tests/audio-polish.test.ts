// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioManager, DEFAULT_VOLUME } from '../src/audio/AudioManager';
import { SOUNDS } from '../src/audio/synth';
import { snd } from '../src/audio/audio';
import { resetCombatAudio, sndEvent } from '../src/audio/combat';
import { app } from '../src/game/state';
import type { SndEv } from '../src/game/state';
import { FakeCtx } from './fake-audio';

/**
 * Phase 5: audio polish and regression. These tests pin the audit fixes — the master protection chain, the priority
 * exemptions on the voice cap, buffer-voice registry cleanup — and sweep every branch of the event-to-sound mapping
 * (combat and all twenty abilities) against the manifest, so a voice can never be renamed out from under a mapping.
 */

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeCtx);
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

const fresh = (): AudioManager => new AudioManager(SOUNDS);

describe('audio polish and regression (phase 5)', () => {
  it('protects the output: 30 Hz high-pass, gentle high-shelf and a soft limiter between master and the speakers', () => {
    const m = fresh(); m.gesture();
    const c = FakeCtx.last!;
    const lim = c.compressors[0], shelf = c.filters.find(f => f.type === 'highshelf')!, hp = c.filters.find(f => f.type === 'highpass')!;
    expect(c.compressors).toHaveLength(1); expect(hp).toBeTruthy(); expect(shelf).toBeTruthy();
    expect(hp.frequency.value).toBe(30); // inaudible rumble is removed before it can pump the limiter
    expect(shelf.frequency.value).toBe(9000); expect(shelf.gain.value).toBeCloseTo(-2.5); // stacked sizzle stays readable
    expect(lim.threshold.value).toBeCloseTo(-2); expect(lim.ratio.value).toBe(12); expect(lim.attack.value).toBeCloseTo(.002); // only peaks move
    // the real graph order: master gain -> high-pass -> high-shelf -> limiter -> destination
    expect(c.gains).toHaveLength(5); // master + sfx/music/ambient/ui
    expect(c.gains[0].out[0]).toBe(hp);
    expect(hp.out[0]).toBe(shelf);
    expect(shelf.out[0]).toBe(lim);
    expect(lim.out[0]).toBe(c.destination);
    m.dispose();
    m.gesture(); // a rebuilt context is protected again (the tear-down cleared the old chain)
    expect(FakeCtx.last!.compressors).toHaveLength(1);
    m.dispose();
  });

  it('drops ordinary sounds at the voice cap but never priority cues, loops of priority or control clicks', () => {
    const m = fresh(); m.gesture(); m.maxVoices = 2;
    expect(m.play('sfx', 'notify')).toBe(true);
    expect(m.play('sfx', 'respawn')).toBe(true); // the mix is full
    const dropped = m.stats.dropped;
    expect(m.play('sfx', 'notify')).toBe(false); // the flood is dropped and counted…
    expect(m.stats.dropped).toBe(dropped + 1);
    expect(m.play('sfx', 'notify', { force: true })).toBe(true); // …but the player's own cue survives
    expect(m.play('ui', 'uiClick')).toBe(true); // and so does a control click
    expect(m.startLoop('music', 'musicMenu')).toBeNull(); // a bed does not jump the saturated queue
    const loop = m.startLoop('music', 'musicMenu', { force: true });
    expect(loop).not.toBeNull(); loop!.stop();
    m.dispose();
  });

  it('a loaded file leaves the voice and spatial registries when it ends (no phantom voices)', async () => {
    const m = fresh(); m.gesture();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) })));
    expect(await m.load('notify', 'assets/audio/notify.ogg')).not.toBeNull();
    m.setListener(0, 0, 0);
    expect(m.play('sfx', 'notify', { pos: { x: 120, y: 0 } })).toBe(true);
    expect(m.snapshot().active).toBe(1);
    expect(m.spatialVoices()).toHaveLength(1);
    FakeCtx.last!.sources[FakeCtx.last!.sources.length - 1].fireEnded(); // the file runs to its end in the browser
    expect(m.snapshot().active).toBe(0);
    expect(m.spatialVoices()).toHaveLength(0);
    m.dispose();
  });

  it('ducking scales the live graph only: stored volumes and the UI bus never move', () => {
    const m = fresh(); m.gesture();
    m.setVolume('sfx', .5);
    m.setDuck(.25);
    const l = m.snapshot().levels;
    expect(l.sfx).toBeCloseTo(.125);
    expect(l.music).toBeCloseTo(DEFAULT_VOLUME.music * .25);
    expect(l.ui).toBeCloseTo(DEFAULT_VOLUME.ui); // menus stay crisp while the world whispers
    expect(m.prefs().sfx).toBeCloseTo(.5); // the persisted setting did not move
    m.setVolume('sfx', .8); // changing a volume while ducked keeps the duck
    expect(m.snapshot().levels.sfx).toBeCloseTo(.2);
    m.setDuck(1);
    expect(m.snapshot().levels.sfx).toBeCloseTo(.8);
    m.dispose();
  });

  it('every branch of the combat and ability mapping names a real manifest voice', () => {
    (app as any).me = null; // no hero: no range culling, so every cue reaches the recording spy
    (app as any).G = { t: 0 } as any;
    const ev = (k: SndEv['k'], kind: string, extra: Partial<SndEv> = {}): SndEv => ({ k, kind, x: 40, y: 0, team: 0, ...extra });
    const events: SndEv[] = [
      // combat: one event per cue branch (including the pack-era weight and feedback branches)
      ev('swing', 'hero'), ev('swing', 'melee'),
      ev('launch', 'heavy'), ev('launch', 'magic'), ev('launch', 'arrow'), ev('launch', 'boss'),
      ev('hit', 'structure'), ev('hit', 'core'), ev('hit', 'blast', { big: true }), ev('hit', 'heavy'), ev('hit', 'magic'), ev('hit', 'arrow'),
      ev('hit', 'melee'), ev('hit', 'melee', { src: 'hero' }), ev('hit', 'melee', { victim: true }),
      ev('die', 'core', { big: true }), ev('die', 'tower', { big: true }), ev('die', 'hero', { uid: 1 }),
      ev('die', 'neutral', { big: true }), ev('die', 'creep'),
      ev('respawn', 'hero'),
      ev('cast', 'bolt'), ev('heal', 'heal'), // no ability id: deliberately silent, never a generic guess
      ev('hit', 'core', { ab: 3 }), ev('hit', 'structure', { ab: 3 }), // structures keep their material voice
    ];
    // abilities: every hero and slot through cast, launch and hit
    for (let h = 0; h < 5; h++) for (let i = 0; i < 4; i++) {
      const ab = h * 4 + i;
      events.push(ev('cast', 'x', { ab }), ev('launch', 'x', { ab }), ev('hit', 'x', { ab }));
    }
    events.push(ev('heal', 'x', { ab: 15 }), ev('heal', 'x', { ab: 0 })); // the Rebirth wave and a normal confirmation

    const seen: { bus: string; name: string }[] = [];
    const play = vi.spyOn(snd, 'play').mockImplementation((bus: any, name: any) => { seen.push({ bus, name }); return true; });
    const loop = vi.spyOn(snd, 'startLoop').mockImplementation((bus: any, name: any) => { seen.push({ bus, name }); return { name, live: true, stop() {} }; });
    try {
      resetCombatAudio();
      events.forEach((e, i) => { (app as any).G.t = i * 10; sndEvent(e); }); // ten seconds apart: every event lands in its own budget window
    } finally { play.mockRestore(); loop.mockRestore(); resetCombatAudio(); }

    expect(seen.length).toBeGreaterThan(40);
    for (const { bus, name } of seen) {
      expect(SOUNDS[name], `the mapping names "${name}", which is missing from the manifest`).toBeTruthy();
      expect(['sfx', 'music', 'ambient', 'ui'], `the mapping uses bus "${bus}"`).toContain(bus); // never master
    }
    const names = seen.map(s => s.name);
    expect(['swing', 'swing2', 'swing3'].some(n => names.includes(n))).toBe(true); // the light-swing takes (V2)
    expect(names).toContain('swingHeavy'); expect(names).toContain('hitMeleeHeavy');
    expect(['hitMelee', 'hitMelee2', 'hitMelee3'].some(n => names.includes(n))).toBe(true); // the light-impact takes (V2)
    expect(names).toContain('siegeShot'); expect(names).toContain('boomBlast');
    expect(names).toContain('coreCollapse'); expect(names).toContain('collapseTower'); expect(names).toContain('hitCore');
    expect(names).toContain('bossAttack'); expect(names).toContain('bossDeath'); expect(names).toContain('heroHit');
    expect(names).toContain('akMeteorImpact'); expect(names).toContain('ngRebirthPulse'); expect(names).toContain('healPulse');
  });

  it('a small blast beyond the camera becomes the distant rumble instead of a full voice', () => {
    const far = { x: 9000, y: 9000 };
    (app as any).me = { x: 0, y: 0 }; // the hero is far away: the range gate silences the local voice
    (app as any).G = { t: 0 } as any;
    const seen: string[] = [];
    const play = vi.spyOn(snd, 'play').mockImplementation((_bus: any, name: any) => { seen.push(name); return true; });
    try { sndEvent({ k: 'hit', kind: 'blast', x: far.x, y: far.y, team: 1 }); } finally { play.mockRestore(); }
    expect(seen).toEqual(['ambDistant']); // one restrained rumble, no boom, no extra layer
    (app as any).me = null;
  });
});
