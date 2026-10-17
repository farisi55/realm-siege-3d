// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AudioManager, DEFAULT_VOLUME, BUSES } from '../src/audio/AudioManager';
import { SOUNDS } from '../src/audio/synth';
import { FakeCtx } from './fake-audio';

// The flow integration at the end boots the real game in jsdom; three.js needs a canvas-only stub (same trick as ui.test.ts).
vi.mock('three', async orig => {
  const t: any = await orig();
  return { ...t, WebGLRenderer: class { domElement = document.createElement('canvas'); shadowMap: any = {}; setPixelRatio() {} setSize() {} render() {} } };
});

// ---------------------------------------------------------------------------------------------------------------- fake Web Audio

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeCtx);
  localStorage.clear();
});
afterEach(() => { vi.unstubAllGlobals(); });

const fresh = (): AudioManager => new AudioManager(SOUNDS);

// ---------------------------------------------------------------------------------------------------------------- engine

describe('AudioManager (engine, stubbed Web Audio)', () => {
  it('is silent before the first user gesture and unlocks after one', () => {
    const m = fresh();
    expect(m.snapshot().gesture).toBe(false);
    expect(m.snapshot().state).toBe('none'); // no AudioContext exists yet
    expect(m.play('ui', 'uiClick')).toBe(false); // dropped, never throws, no nodes built
    m.gesture();
    expect(m.unlocked).toBe(true);
    expect(m.play('ui', 'uiClick')).toBe(true);
    expect(m.stats.played).toBe(1);
    m.dispose();
  });

  it('routes each bus to its own gain node and clamps volumes to 0..1', () => {
    const m = fresh(); m.gesture();
    m.setVolume('sfx', 2); expect(m.getVolume('sfx')).toBe(1);
    m.setVolume('music', -.5); expect(m.getVolume('music')).toBe(0);
    m.setVolume('sfx', .25);
    const l = m.snapshot().levels;
    expect(l.master).toBeCloseTo(DEFAULT_VOLUME.master);
    expect(l.sfx).toBeCloseTo(.25);
    expect(l.music).toBeCloseTo(0); // the clamp reached its own bus node
    expect(l.ambient).toBeCloseTo(DEFAULT_VOLUME.ambient); // untouched buses keep their default
    expect(l.ui).toBeCloseTo(DEFAULT_VOLUME.ui);
    m.dispose();
  });

  it('mutes and unmutes immediately and blocks new voices while muted', () => {
    const m = fresh(); m.gesture();
    expect(m.play('sfx', 'notify')).toBe(true);
    m.setMuted(true);
    expect(m.snapshot().levels.master).toBe(0); // the graph is at zero right away
    expect(m.play('sfx', 'notify')).toBe(false); // and no new nodes are built
    m.stopAll();
    m.setMuted(false);
    expect(m.snapshot().levels.master).toBeCloseTo(DEFAULT_VOLUME.master);
    expect(m.play('sfx', 'notify')).toBe(true);
    m.dispose();
  });

  it('drops duplicates inside minGap and voices beyond the cap', () => {
    const m = fresh(); m.gesture();
    expect(m.play('ui', 'uiClick')).toBe(true);
    expect(m.play('ui', 'uiClick')).toBe(false); // minGap held
    m.maxVoices = 1;
    expect(m.play('sfx', 'notify')).toBe(false); // one voice already live
    expect(m.stats.dropped).toBeGreaterThan(0);
    m.dispose();
  });

  it('stopAll clears one bus or everything', () => {
    const m = fresh(); m.gesture();
    m.play('ui', 'uiClick'); m.play('sfx', 'notify');
    expect(m.snapshot().active).toBe(2);
    m.stopAll('ui');
    expect(m.snapshot().active).toBe(1);
    m.stopAll();
    expect(m.snapshot().active).toBe(0);
    m.dispose();
  });

  it('persists volumes and mute through storage and resets to defaults', () => {
    const a = fresh(); a.gesture();
    a.setVolume('master', .33); a.setVolume('ambient', .12); a.setMuted(true);
    const b = fresh(); // a fresh page load
    expect(b.getVolume('master')).toBeCloseTo(.33);
    expect(b.getVolume('ambient')).toBeCloseTo(.12);
    expect(b.isMuted()).toBe(true);
    b.reset();
    expect(b.getVolume('master')).toBeCloseTo(DEFAULT_VOLUME.master);
    expect(b.isMuted()).toBe(false);
    for (const bus of BUSES) expect(b.getVolume(bus)).toBeCloseTo(DEFAULT_VOLUME[bus]);
    a.dispose(); b.dispose();
  });

  it('survives a failed asset load and keeps the synth fallback', async () => {
    const m = fresh(); m.gesture();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    expect(await m.load('uiClick', 'assets/audio/ui-click.ogg')).toBeNull(); // never rejects
    expect(m.play('ui', 'uiClick')).toBe(true); // synthesis is still there
    expect(m.play('sfx', 'does-not-exist')).toBe(false); // unknown sound: no throw either
    m.dispose();
  });

  it('caches a loaded file instead of refetching it', async () => {
    const m = fresh(); m.gesture();
    const f = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }));
    vi.stubGlobal('fetch', f);
    const one = await m.load('uiClick', 'a.ogg');
    const two = await m.load('uiClick', 'b.ogg'); // same name: the cache answers, no second fetch
    expect(one).not.toBeNull(); expect(one).toBe(two);
    expect(f).toHaveBeenCalledTimes(1);
    m.dispose();
  });

  it('never throws when Web Audio is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    const m = fresh(); m.gesture();
    expect(m.ensure()).toBeNull();
    expect(m.play('ui', 'uiClick')).toBe(false);
    m.setVolume('master', .5); m.setMuted(true); m.stopAll(); m.dispose(); // all no-ops, no exceptions
  });
});

// ---------------------------------------------------------------------------------------------------------------- facade

async function freshFacade() {
  vi.resetModules();
  localStorage.clear();
  return await import('../src/audio/audio');
}

describe('audio facade (gesture unlock, delegated UI click, buses)', () => {
  it('creates and resumes the context on the first pointer or key gesture', async () => {
    const A = await freshFacade();
    A.initAudio();
    expect(A.isAudioUnlocked()).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    expect(A.isAudioUnlocked()).toBe(true);
    expect(A.playUI('uiClick')).toBe(true);
  });

  it('plays the UI click for any button through one delegated listener', async () => {
    const A = await freshFacade();
    A.initAudio();
    window.dispatchEvent(new Event('keydown'));
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    const before = A.audioStats().played;
    btn.click();
    expect(A.audioStats().played).toBe(before + 1);
    btn.remove();
  });

  it('exposes independent bus volumes and mute through the facade API', async () => {
    const A = await freshFacade();
    A.initAudio();
    window.dispatchEvent(new Event('pointerdown'));
    A.setVolume('music', .4); A.setVolume('ambient', .2);
    const l = A.audioStats().levels;
    expect(l.music).toBeCloseTo(.4); expect(l.ambient).toBeCloseTo(.2);
    expect(l.sfx).toBeCloseTo(DEFAULT_VOLUME.sfx); // the other buses are untouched
    A.setMuted(true);
    expect(A.audioStats().levels.master).toBe(0);
    A.setMuted(false);
    A.stopAll();
  });

  it('stops every voice on pagehide (cleanup without throwing)', async () => {
    const A = await freshFacade();
    A.initAudio();
    window.dispatchEvent(new Event('pointerdown'));
    expect(A.playUI('notify')).toBe(true);
    expect(A.audioStats().active).toBeGreaterThan(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(A.audioStats().active).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------- flow integration

describe('match start (flow integration, stubbed WebGL)', () => {
  it('unlocks on the gesture and plays exactly the match-start sound when Play starts a match', async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('rs_bloom', 'false'); // the stubbed renderer has no composer
    document.body.innerHTML = '<div id="g"></div><div id="ftl"></div><div id="root"></div>';
    const ctx2d = new Proxy({}, { get: (t: any, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t: any, k, v) => ((t[k] = v), true) });
    (HTMLCanvasElement.prototype as any).getContext = () => ctx2d;

    const A = await import('../src/audio/audio');
    const F = await import('../src/flow');
    await F.boot();
    window.dispatchEvent(new Event('pointerdown')); // the player's first click
    expect(A.isAudioUnlocked()).toBe(true);

    const before = A.audioStats().played;
    F.play(); // the Play button handler: startMatch() then the match-start sound
    expect(A.audioStats().played).toBe(before + 1);
    expect(A.audioStats().state).toBe('running');
  }, 30000);
});
