import type { SoundDef, StopFn, SynthIo } from './AudioManager';

/**
 * The built-in sound set: small, original voices synthesized with oscillators and one shared noise buffer — no external
 * assets, no third-party samples. Every definition may gain `urls` later (see `SoundDef`); the synth then stays as the
 * fallback whenever a file is missing or undecodable, so the game is never silent because an asset did not ship.
 */

/** One oscillator voice: a short tone that glides from `f` to `f1` with an attack/decay envelope. */
interface ToneOpt {
  /** Start frequency (Hz). */
  f: number;
  /** End frequency for a glide (default: none). */
  f1?: number;
  type?: OscillatorType;
  /** Offset from `io.t0` (default 0). */
  at?: number;
  /** Attack time (default .005). */
  a?: number;
  /** Decay time after the attack. */
  d: number;
  /** Peak of the envelope, 0..1 relative to `io.gain` (default 1). */
  peak?: number;
  /** Optional lowpass cutoff (Hz); keeps the harsher oscillator types soft. */
  filter?: number;
}

/** A tonal voice. Exponentials are floored at .0001 because Web Audio cannot ramp to zero. Frequencies follow `io.rate`. */
function tone(io: SynthIo, o: ToneOpt): StopFn {
  const { ctx } = io, at = io.t0 + (o.at ?? 0), a = Math.max(.002, o.a ?? .005), end = at + a + o.d, r = io.rate || 1;
  const peak = Math.max(.0001, (o.peak ?? 1) * io.gain);
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f * r, at);
  if (o.f1 && o.f1 !== o.f) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1 * r), end);
  g.gain.setValueAtTime(.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + a);
  g.gain.exponentialRampToValueAtTime(.0001, end);
  osc.connect(g);
  let out: AudioNode = g;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(o.filter * r, at);
    g.connect(f); out = f;
  }
  out.connect(io.dest);
  osc.start(at);
  osc.stop(end + .02);
  osc.onended = io.done;
  return () => { try { osc.stop(); } catch { /* already stopped */ } try { osc.disconnect(); g.disconnect(); } catch { /* already gone */ } };
}

/** A noise voice (filtered, from the one shared buffer): whooshes, bursts, booms. `cut1` sweeps the cutoff by the end. */
function noiseSwell(io: SynthIo, o: { at?: number; a?: number; d: number; cut?: number; cut1?: number; type?: BiquadFilterType; peak?: number }): StopFn {
  const { ctx } = io, at = io.t0 + (o.at ?? 0), a = o.a ?? .12, end = at + a + o.d, r = io.rate || 1;
  const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = io.noise; src.loop = true;
  f.type = o.type ?? 'lowpass'; f.frequency.setValueAtTime(Math.max(20, (o.cut ?? 900) * r), at);
  if (o.cut1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.cut1 * r), end);
  g.gain.setValueAtTime(.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(.0001, (o.peak ?? .5) * io.gain), at + a);
  g.gain.exponentialRampToValueAtTime(.0001, end);
  src.connect(f); f.connect(g); g.connect(io.dest);
  src.start(at);
  src.stop(end + .02);
  src.onended = io.done;
  return () => { try { src.stop(); } catch { /* already stopped */ } try { src.disconnect(); f.disconnect(); g.disconnect(); } catch { /* already gone */ } };
}

/** Layers voices into one sound. */
const mix = (...fns: StopFn[]): StopFn => () => { for (const f of fns) f(); };

/**
 * The built-in set. Phase 1: the UI voices (`uiClick` is wired to the delegated click in `initAudio`, `matchStart` to
 * `flow.play`). Phase 2: the combat voices — swings, launches, material impacts, deaths and structure losses — played
 * by `audio/combat.ts` from the simulation's `hooks.snd` events. Every voice layers original oscillators and filtered
 * noise; a `minGap` swallows duplicate events, a `max` caps how many copies may ring at once, and no third-party
 * samples are used anywhere.
 */
export const SOUNDS: Record<string, SoundDef> = {
  /** A short, dry click for buttons, hero cards and sliders. */
  uiClick: {
    gain: .5, minGap: 40,
    synth: io => tone(io, { f: 720, f1: 500, type: 'triangle', d: .06, peak: .9, filter: 3400 }),
  },
  /** Two quick steps for a checkbox or select changing. */
  uiToggle: {
    gain: .55, minGap: 40,
    synth: io => mix(
      tone(io, { f: 480, d: .045, type: 'square', peak: .35, filter: 2600 }),
      tone(io, { f: 720, d: .06, type: 'square', peak: .3, filter: 2600, at: .05 }),
    ),
  },
  /** A soft two-note chime for non-combat notifications. */
  notify: {
    gain: .6,
    synth: io => mix(
      tone(io, { f: 587.33, d: .18, peak: .5, filter: 3000 }),
      tone(io, { f: 880, d: .26, peak: .45, filter: 3200, at: .09 }),
    ),
  },
  /** March start: a rising third, a bright ping and a soft noise swell under it. */
  matchStart: {
    gain: .8, minGap: 250,
    synth: io => mix(
      tone(io, { f: 392, d: .55, peak: .4, a: .03, filter: 2800 }),
      tone(io, { f: 493.88, d: .55, peak: .34, a: .03, at: .03, filter: 2800 }),
      tone(io, { f: 587.33, d: .6, peak: .3, a: .03, at: .06, filter: 3000 }),
      tone(io, { f: 1174.66, d: .3, peak: .3, a: .002, at: .1, filter: 4200 }),
      noiseSwell(io, { d: .5, a: .12, peak: .18, cut: 1200 }),
    ),
  },

  // ---- Phase 2: combat --------------------------------------------------------------------------------------------

  /** Melee windup: a bandpassed noise whoosh sweeping down as the weapon cuts air. */
  swing: {
    gain: .5, minGap: 70, max: 4,
    synth: io => noiseSwell(io, { a: .02, d: .16, cut: 1800, cut1: 320, type: 'bandpass', peak: .8 }),
  },
  /** Bow release: a short wooden pluck with the string twang on top. */
  bowShot: {
    gain: .6, minGap: 60, max: 3,
    synth: io => mix(
      tone(io, { f: 330, f1: 130, type: 'triangle', d: .09, peak: .5, filter: 2200 }),
      noiseSwell(io, { a: .003, d: .1, cut: 1500, cut1: 300, peak: .35 }),
    ),
  },
  /** Siege engine / tower launch: a heavy mechanical thunk rolling into a whoosh. */
  siegeShot: {
    gain: .8, minGap: 150, max: 2,
    synth: io => mix(
      tone(io, { f: 150, f1: 58, type: 'square', d: .2, peak: .55, filter: 700 }),
      noiseSwell(io, { a: .05, d: .3, cut: 900, cut1: 180, peak: .4 }),
    ),
  },
  /** Arcane launch: a rising shimmer as the bolt leaves the caster. */
  magicShot: {
    gain: .6, minGap: 80, max: 3,
    synth: io => mix(
      tone(io, { f: 320, f1: 880, d: .2, peak: .4, filter: 3600 }),
      tone(io, { f: 640, f1: 1760, d: .16, peak: .18, at: .02 }),
    ),
  },
  /** Bladed impact on flesh and armor: a low body thud plus a short chop of noise. */
  hitMelee: {
    gain: .8, minGap: 60, max: 4,
    synth: io => mix(
      tone(io, { f: 150, f1: 52, d: .14, peak: .85 }),
      noiseSwell(io, { a: .003, d: .08, cut: 1300, cut1: 450, peak: .5 }),
    ),
  },
  /** Arrow/bolt tick: a bright snap with almost no body. */
  hitArrow: {
    gain: .6, minGap: 55, max: 4,
    synth: io => mix(
      noiseSwell(io, { a: .002, d: .05, cut: 2600, cut1: 1100, type: 'bandpass', peak: .7 }),
      tone(io, { f: 950, f1: 600, type: 'triangle', d: .04, peak: .22 }),
    ),
  },
  /** Magic impact: a warm blip sliding down with a sizzle behind it. */
  hitMagic: {
    gain: .7, minGap: 70, max: 3,
    synth: io => mix(
      tone(io, { f: 700, f1: 250, d: .15, peak: .45, filter: 2600 }),
      tone(io, { f: 1400, f1: 520, d: .09, peak: .18, at: .01 }),
      noiseSwell(io, { a: .002, d: .07, cut: 3800, cut1: 1500, type: 'highpass', peak: .28 }),
    ),
  },
  /** Tower/siege bolt impact: a loaded thud with a metal ring. */
  hitHeavy: {
    gain: .85, minGap: 90, max: 2,
    synth: io => mix(
      tone(io, { f: 120, f1: 42, d: .22, peak: .9 }),
      tone(io, { f: 520, f1: 380, type: 'triangle', d: .3, peak: .16, filter: 1800 }),
      noiseSwell(io, { a: .003, d: .1, cut: 950, cut1: 300, peak: .5 }),
    ),
  },
  /** Damage to a tower: a stone knock with a wooden crack, distinct from unit impacts. */
  hitStructure: {
    gain: .8, minGap: 90, max: 3,
    synth: io => mix(
      tone(io, { f: 210, f1: 80, type: 'square', d: .12, peak: .6, filter: 900 }),
      noiseSwell(io, { a: .002, d: .07, cut: 1500, cut1: 500, peak: .45 }),
    ),
  },
  /** Damage to the core: a deep magical toll that cuts through the mix. */
  hitCore: {
    gain: 1, minGap: 140, max: 2,
    synth: io => mix(
      tone(io, { f: 110, f1: 40, d: .3, peak: .8 }),
      tone(io, { f: 880, f1: 220, d: .28, peak: .2, at: .01, filter: 2600 }),
      noiseSwell(io, { a: .01, d: .3, cut: 2400, cut1: 300, type: 'bandpass', peak: .32 }),
    ),
  },
  /** Area damage: one big boom per blast (the layer silences the per-victim hits). */
  boomBlast: {
    gain: .9, minGap: 130, max: 2,
    synth: io => mix(
      tone(io, { f: 90, f1: 28, d: .4, peak: .95 }),
      noiseSwell(io, { a: .01, d: .45, cut: 900, cut1: 110, peak: .8 }),
      noiseSwell(io, { a: .002, d: .12, cut: 2400, cut1: 600, peak: .4 }),
    ),
  },
  /** A creep or neutral falls: a small squelch with a falling tone. */
  dieCreep: {
    gain: .6, minGap: 100, max: 3,
    synth: io => mix(
      tone(io, { f: 260, f1: 70, type: 'triangle', d: .18, peak: .55, filter: 1200 }),
      noiseSwell(io, { a: .004, d: .14, cut: 700, cut1: 180, peak: .38 }),
    ),
  },
  /** A hero (or a jungle boss) falls: a longer, weightier fall with a low bloom under it. */
  dieBig: {
    gain: .9, minGap: 120, max: 2,
    synth: io => mix(
      tone(io, { f: 340, f1: 90, d: .5, peak: .6, filter: 1600 }),
      tone(io, { f: 170, f1: 52, d: .55, peak: .45, at: .05 }),
      noiseSwell(io, { a: .01, d: .4, cut: 900, cut1: 140, peak: .45 }),
    ),
  },
  /** A tower comes down: rumble, a ground thud and two waves of debris. */
  collapseTower: {
    gain: 1, max: 1,
    synth: io => mix(
      noiseSwell(io, { a: .05, d: .7, cut: 500, cut1: 90, peak: .9 }),
      tone(io, { f: 90, f1: 34, d: .6, peak: .75, at: .04 }),
      tone(io, { f: 320, f1: 60, type: 'square', d: .2, peak: .4, at: .2, filter: 700 }),
      tone(io, { f: 260, f1: 50, type: 'square', d: .2, peak: .32, at: .4, filter: 600 }),
    ),
  },
  /** Core destruction: the match-ending explosion with a long energy collapse into silence. */
  coreCollapse: {
    gain: 1.15, max: 1,
    synth: io => mix(
      tone(io, { f: 70, f1: 24, d: .9, peak: .95 }),
      noiseSwell(io, { a: .015, d: 1.1, cut: 1400, cut1: 90, peak: .9 }),
      tone(io, { f: 1400, f1: 110, d: 1.2, peak: .3, at: .1, filter: 4000 }),
      tone(io, { f: 700, f1: 60, d: 1, peak: .28, at: .25 }),
      tone(io, { f: 2350, f1: 1700, d: .6, peak: .12, at: .5 }),
    ),
  },
  /** Hero respawn: an ascending chime, the counterpart of `dieBig`. */
  respawn: {
    gain: .7, max: 2,
    synth: io => mix(
      tone(io, { f: 440, f1: 880, d: .35, peak: .42, filter: 3200 }),
      tone(io, { f: 660, f1: 1320, d: .3, peak: .24, at: .06 }),
      tone(io, { f: 1760, d: .25, peak: .13, at: .18 }),
    ),
  },
};
