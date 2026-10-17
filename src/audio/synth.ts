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
 * A sustained fire bed for Burning Zone: an ignition whoomph (so the impact event that starts it reads as the ignition)
 * over a subdued looping roar and a quieter crackle layer. It fades out on its own after `dur` seconds — a lingering
 * burn, not an eternal one — and `stop` fades it early (owner death, match restart). The first sound in the game built
 * to run until stopped; everything else is fire-and-forget.
 */
function fireBed(io: SynthIo, dur = 3): StopFn {
  const { ctx } = io, at = io.t0, r = io.rate || 1;
  const bed = (type: BiquadFilterType, cut: number, peak: number) => {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = io.noise; src.loop = true;
    f.type = type; f.frequency.value = cut * r;
    g.gain.setValueAtTime(.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(.0001, io.gain * peak), at + .3);
    g.gain.exponentialRampToValueAtTime(.0001, at + dur);
    src.connect(f); f.connect(g); g.connect(io.dest);
    src.start(at);
    return { src, g };
  };
  const roar = bed('lowpass', 420, .55), crackle = bed('bandpass', 2600, .14);
  const thump = tone(io, { f: 92, f1: 34, d: .5, peak: .9 }); // the ignition itself
  const end = at + dur + .1;
  roar.src.stop(end); crackle.src.stop(end);
  roar.src.onended = () => { io.done(); try { roar.g.disconnect(); crackle.g.disconnect(); } catch { /* already gone */ } };
  return () => {
    const now = ctx.currentTime;
    for (const p of [roar.g, crackle.g]) {
      try {
        p.gain.cancelScheduledValues(now);
        p.gain.setValueAtTime(Math.max(.0001, p.gain.value), now);
        p.gain.exponentialRampToValueAtTime(.0001, now + .3);
      } catch { /* the param is gone */ }
    }
    try { roar.src.stop(now + .35); } catch { /* already stopped */ }
    try { crackle.src.stop(now + .35); } catch { /* already stopped */ }
    thump();
  };
}

/**
 * The built-in set. Phase 1: the UI voices (`uiClick` is wired to the delegated click in `initAudio`, `matchStart` to
 * `flow.play`). Phase 2: the combat voices — swings, launches, material impacts, deaths and structure losses — played
 * by `audio/combat.ts` from the simulation's `hooks.snd` events. Phase 3: the hero and ability voices — one family per
 * hero (`audio/abilities.ts` maps them to the same event stream, never a second audio system). Every voice layers
 * original oscillators and filtered noise; a `minGap` swallows duplicate events, a `max` caps how many copies may ring
 * at once, and no third-party samples are used anywhere.
 *
 * This table is the sound manifest: gameplay only ever names a voice, so any entry may gain `urls` later (replacing
 * the synthesized fallback with a local file) without touching a line of simulation or cue-mapping code. `emZoneFire`
 * is the one sustained voice: a `loop` def started by `startLoop` and stopped on owner death or match restart.
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

  // ---- Phase 3: hero and ability voices -----------------------------------------------------------------------------
  // One family per hero; every ability keeps its own voice, wired in `audio/abilities.ts`. Cast wind-ups are quiet and
  // short (they must resolve into the +250 ms release), ultimates get the richest layering, and the only sustained
  // voice is `emZoneFire` (a `loop` def started with `startLoop`).

  // Arcane Knight — warm bells and steel over low thuds.
  /** Q wind-up: the arcane bolt charging in the hand. */
  akStrikeCharge: {
    gain: .45, minGap: 120, max: 2,
    synth: io => mix(
      tone(io, { f: 300, f1: 640, d: .2, peak: .35, filter: 3200 }),
      noiseSwell(io, { a: .03, d: .17, cut: 500, cut1: 2600, type: 'bandpass', peak: .3 }),
    ),
  },
  /** Q release: the bolt leaving with a bright two-voice shimmer. */
  akStrike: {
    gain: .65, minGap: 90, max: 3,
    synth: io => mix(
      tone(io, { f: 620, f1: 1240, d: .16, peak: .4 }),
      tone(io, { f: 930, d: .12, peak: .2, at: .02, filter: 4000 }),
      noiseSwell(io, { a: .004, d: .14, cut: 1600, cut1: 3600, type: 'bandpass', peak: .3 }),
    ),
  },
  /** Q impact: the arcane burst landing — magical crack plus a steel tick. */
  akStrikeHit: {
    gain: .75, minGap: 70, max: 3,
    synth: io => mix(
      tone(io, { f: 880, f1: 300, d: .18, peak: .5, filter: 3600 }),
      tone(io, { f: 1320, f1: 440, d: .1, peak: .22, at: .01 }),
      tone(io, { f: 150, f1: 60, d: .12, peak: .5 }),
      noiseSwell(io, { a: .002, d: .1, cut: 2400, cut1: 500, peak: .4 }),
    ),
  },
  /** W (Shield Wall): a warm ward rising in a major triad — protection, not damage. */
  akShield: {
    gain: .75, minGap: 400, max: 1,
    synth: io => mix(
      tone(io, { f: 392, d: .5, peak: .4, a: .04, filter: 3200 }),
      tone(io, { f: 523.25, d: .45, peak: .34, a: .04, at: .06 }),
      tone(io, { f: 659.25, d: .4, peak: .28, a: .04, at: .12 }),
      noiseSwell(io, { a: .15, d: .4, cut: 500, cut1: 2200, peak: .3 }),
    ),
  },
  /** E wind-up: force and gravel gathering for a quarter second. */
  akSlamWind: {
    gain: .6, minGap: 300, max: 1,
    synth: io => mix(
      tone(io, { f: 55, f1: 118, d: .25, peak: .6 }),
      noiseSwell(io, { a: .05, d: .22, cut: 300, cut1: 1400, peak: .5 }),
    ),
  },
  /** E impact: the slam itself, with the shockwave ring layered a beat behind it. */
  akSlamImpact: {
    gain: 1, minGap: 200, max: 1,
    synth: io => mix(
      tone(io, { f: 95, f1: 28, d: .45, peak: .95 }),
      noiseSwell(io, { a: .008, d: .4, cut: 900, cut1: 90, peak: .85 }),
      tone(io, { f: 220, f1: 70, type: 'square', d: .15, at: .05, peak: .5, filter: 800 }),
      tone(io, { f: 340, f1: 90, d: .3, at: .12, peak: .3 }),
      noiseSwell(io, { a: .01, d: .3, at: .12, cut: 500, cut1: 150, peak: .3 }),
    ),
  },
  /** R build-up: the meteor falling in — whistle down, rumble up, landing on the blast. */
  akMeteorBuild: {
    gain: .85, minGap: 600, max: 1,
    synth: io => mix(
      tone(io, { f: 1200, f1: 280, d: .3, peak: .45 }),
      tone(io, { f: 45, f1: 85, d: .3, peak: .6 }),
      noiseSwell(io, { a: .05, d: .28, cut: 200, cut1: 1200, peak: .4 }),
    ),
  },
  /** R impact: the crash plus the crystal prison ringing the target shut. */
  akMeteorImpact: {
    gain: 1.15, minGap: 600, max: 1,
    synth: io => mix(
      tone(io, { f: 80, f1: 24, d: .8, peak: 1 }),
      noiseSwell(io, { a: .008, d: .7, cut: 1500, cut1: 70, peak: .9 }),
      tone(io, { f: 300, f1: 60, type: 'square', d: .2, at: .25, peak: .5, filter: 700 }),
      tone(io, { f: 1568, f1: 784, d: .4, at: .15, peak: .25, filter: 4000 }),
      tone(io, { f: 2350, d: .3, at: .5, peak: .15 }),
    ),
  },

  // Shadow Huntress — dark air, breathy noise and minor intervals.
  /** Q landing: a blade-drawn whoosh that lands on a quick cut, in one voice. */
  shDash: {
    gain: .9, minGap: 250, max: 1,
    synth: io => mix(
      noiseSwell(io, { a: .03, d: .2, cut: 2600, cut1: 420, type: 'bandpass', peak: .9 }),
      noiseSwell(io, { a: .002, d: .07, at: .18, cut: 3200, cut1: 900, type: 'bandpass', peak: .7 }),
      tone(io, { f: 520, f1: 180, d: .1, at: .18, peak: .35 }),
    ),
  },
  /** W release: a lighter bow than the creeps', with venom hissing off the arrow. */
  shPoison: {
    gain: .6, minGap: 90, max: 3,
    synth: io => mix(
      tone(io, { f: 300, f1: 120, type: 'triangle', d: .12, peak: .5, filter: 2200 }),
      tone(io, { f: 980, f1: 1400, d: .08, at: .02, peak: .15 }),
      noiseSwell(io, { a: .004, d: .16, cut: 1400, cut1: 3200, type: 'highpass', peak: .35 }),
    ),
  },
  /** W impact: a wet venom splat with a toxic sizzle on top. */
  shPoisonHit: {
    gain: .7, minGap: 80, max: 3,
    synth: io => mix(
      noiseSwell(io, { a: .002, d: .12, cut: 1400, cut1: 240, peak: .6 }),
      tone(io, { f: 620, f1: 140, type: 'triangle', d: .16, peak: .4 }),
      tone(io, { f: 1900, f1: 700, d: .06, at: .02, peak: .2 }),
    ),
  },
  /** E: a smoke veil bursting and settling, with a whisper of stealth under it. */
  shVeil: {
    gain: .65, minGap: 400, max: 1,
    synth: io => mix(
      noiseSwell(io, { a: .06, d: .35, cut: 700, cut1: 300, type: 'bandpass', peak: .6 }),
      noiseSwell(io, { a: .1, d: .3, at: .05, cut: 2400, cut1: 900, type: 'highpass', peak: .25 }),
      tone(io, { f: 640, f1: 510, d: .25, at: .06, peak: .2, filter: 2400 }),
    ),
  },
  /** R cast: the mark sinking in — a minor-second sting that promises the burst. */
  shMark: {
    gain: .7, minGap: 400, max: 1,
    synth: io => mix(
      tone(io, { f: 415, d: .22, peak: .35 }),
      tone(io, { f: 440, d: .22, at: .02, peak: .3 }),
      tone(io, { f: 220, f1: 180, d: .3, at: .06, peak: .3 }),
      noiseSwell(io, { a: .01, d: .2, cut: 1200, cut1: 600, type: 'bandpass', peak: .35 }),
    ),
  },
  /** R detonation: the mark bursts — a dark core with shards flying off. */
  shMarkBurst: {
    gain: 1.05, minGap: 400, max: 1,
    synth: io => mix(
      tone(io, { f: 100, f1: 30, d: .7, peak: .95 }),
      noiseSwell(io, { a: .008, d: .6, cut: 2400, cut1: 80, peak: .85 }),
      tone(io, { f: 700, f1: 200, d: .12, at: .04, peak: .3, filter: 2600 }),
      tone(io, { f: 900, f1: 260, d: .12, at: .09, peak: .26, filter: 2800 }),
      tone(io, { f: 1300, f1: 380, d: .12, at: .14, peak: .22, filter: 3200 }),
      tone(io, { f: 55, f1: 22, d: .5, at: .1, peak: .5 }),
    ),
  },

  // Ember Mage — fire: filtered-noise whooshes, crackles and low whoomphs.
  /** Q wind-up: fire gathering in the palm. */
  emFireCharge: {
    gain: .5, minGap: 120, max: 2,
    synth: io => mix(
      noiseSwell(io, { a: .04, d: .18, cut: 300, cut1: 1500, peak: .5 }),
      tone(io, { f: 180, f1: 420, type: 'triangle', d: .18, peak: .3, filter: 2200 }),
    ),
  },
  /** Q release: the bolt igniting forward with a spark ticking off the tip. */
  emFireCast: {
    gain: .7, minGap: 80, max: 3,
    synth: io => mix(
      noiseSwell(io, { a: .008, d: .18, cut: 400, cut1: 2000, type: 'bandpass', peak: .7 }),
      tone(io, { f: 240, f1: 660, d: .14, peak: .35 }),
      noiseSwell(io, { a: .002, d: .05, at: .14, cut: 3000, cut1: 5200, type: 'highpass', peak: .3 }),
    ),
  },
  /** Q impact: a fire burst with crackles sparking out of the hit. */
  emFireHit: {
    gain: .8, minGap: 70, max: 4,
    synth: io => mix(
      noiseSwell(io, { a: .003, d: .2, cut: 1800, cut1: 300, peak: .75 }),
      tone(io, { f: 150, f1: 60, d: .15, peak: .7 }),
      tone(io, { f: 2200, f1: 1200, d: .07, at: .03, peak: .18 }),
      tone(io, { f: 1600, f1: 900, d: .05, at: .08, peak: .15 }),
    ),
  },
  /** W: the flame wave sweeping out and washing back over everything nearby. */
  emWave: {
    gain: .9, minGap: 200, max: 1,
    synth: io => mix(
      noiseSwell(io, { a: .03, d: .35, cut: 500, cut1: 2600, peak: .8 }),
      noiseSwell(io, { a: .05, d: .4, at: .1, cut: 1200, cut1: 200, peak: .6 }),
      tone(io, { f: 70, f1: 38, d: .5, peak: .8 }),
      tone(io, { f: 2400, f1: 1400, d: .06, at: .12, peak: .16 }),
      tone(io, { f: 1800, f1: 1100, d: .05, at: .2, peak: .14 }),
    ),
  },
  /** E cast: the flint strike that lights the pool; the fire itself is `emZoneFire`. */
  emZone: {
    gain: .6, minGap: 300, max: 2,
    synth: io => mix(
      noiseSwell(io, { a: .002, d: .12, cut: 1800, cut1: 3600, type: 'highpass', peak: .5 }),
      tone(io, { f: 90, f1: 60, d: .12, at: .04, peak: .5 }),
      tone(io, { f: 2600, f1: 1600, d: .05, at: .08, peak: .2 }),
    ),
  },
  /** E ignition: the whoomph that starts the pool plus a subdued crackling fire bed (fades after ~3 s, loopable). */
  emZoneFire: {
    gain: .55, minGap: 200, max: 2, loop: true,
    synth: io => fireBed(io),
  },
  /** R build-up: the storm gathering above the cursor. */
  emStormBuild: {
    gain: .9, minGap: 600, max: 1,
    synth: io => mix(
      noiseSwell(io, { a: .06, d: .28, cut: 200, cut1: 2400, peak: .8 }),
      tone(io, { f: 40, f1: 130, d: .3, peak: .65 }),
      tone(io, { f: 800, f1: 1600, d: .2, at: .1, peak: .2 }),
    ),
  },
  /** R impact: a major explosion with fire layers cascading through it. */
  emStormImpact: {
    gain: 1.15, minGap: 600, max: 1,
    synth: io => mix(
      tone(io, { f: 75, f1: 22, d: 1, peak: 1 }),
      noiseSwell(io, { a: .01, d: .9, cut: 1800, cut1: 60, peak: .9 }),
      tone(io, { f: 300, f1: 90, type: 'square', d: .3, at: .15, peak: .5, filter: 900 }),
      tone(io, { f: 2400, f1: 1300, d: .07, at: .18, peak: .2 }),
      tone(io, { f: 1900, f1: 1000, d: .06, at: .3, peak: .18 }),
      tone(io, { f: 1500, f1: 800, d: .06, at: .42, peak: .15 }),
      tone(io, { f: 50, f1: 30, d: 1.1, at: .2, peak: .4 }),
    ),
  },

  // Nature Guardian — organic and consonant: soft thumps, plucks, leaf noise; healing is never noisy.
  /** Q: a seed thumping into soil and sprouting two soft notes. */
  ngSeed: {
    gain: .7, minGap: 250, max: 2,
    synth: io => mix(
      tone(io, { f: 130, f1: 70, d: .14, peak: .6 }),
      tone(io, { f: 660, d: .18, at: .06, peak: .35, filter: 3200 }),
      tone(io, { f: 990, d: .16, at: .14, peak: .25, filter: 3400 }),
    ),
  },
  /** A healed ally confirmed: one soft sparkle, shared by every heal so healing never sounds like damage. */
  healPulse: {
    gain: .6, minGap: 60, max: 3,
    synth: io => mix(
      tone(io, { f: 880, d: .16, peak: .4, filter: 3600 }),
      tone(io, { f: 1318.5, d: .2, at: .05, peak: .25, filter: 4000 }),
      noiseSwell(io, { a: .012, d: .15, cut: 2600, cut1: 4200, type: 'highpass', peak: .15 }),
    ),
  },
  /** W: roots erupting under the cursor — wood, soil and two sharp snaps. */
  ngRoot: {
    gain: .85, minGap: 200, max: 1,
    synth: io => mix(
      tone(io, { f: 140, f1: 60, type: 'square', d: .18, peak: .7, filter: 900 }),
      noiseSwell(io, { a: .01, d: .25, cut: 900, cut1: 300, type: 'bandpass', peak: .7 }),
      tone(io, { f: 300, f1: 150, type: 'triangle', d: .12, at: .06, peak: .4 }),
      tone(io, { f: 180, f1: 90, type: 'square', d: .1, at: .16, peak: .35, filter: 1000 }),
    ),
  },
  /** E: leaves closing into a barrier — a warm rising ward. */
  ngBarrier: {
    gain: .75, minGap: 400, max: 1,
    synth: io => mix(
      tone(io, { f: 330, d: .5, peak: .4, a: .04, filter: 3000 }),
      tone(io, { f: 440, d: .45, at: .06, peak: .35, a: .04, filter: 3000 }),
      noiseSwell(io, { a: .12, d: .35, cut: 700, cut1: 2200, type: 'highpass', peak: .3 }),
    ),
  },
  /** R build-up: a major triad gathering — hope one chord at a time. */
  ngRebirthBuild: {
    gain: .85, minGap: 600, max: 1,
    synth: io => mix(
      tone(io, { f: 261.63, d: .4, peak: .35, a: .03, filter: 3000 }),
      tone(io, { f: 329.63, d: .4, at: .06, peak: .32, a: .03, filter: 3000 }),
      tone(io, { f: 392, d: .4, at: .12, peak: .3, a: .03, filter: 3200 }),
      noiseSwell(io, { a: .1, d: .3, cut: 300, cut1: 1800, peak: .35 }),
    ),
  },
  /** R wave: the healing pulse itself — a bright major bloom over the whole team. */
  ngRebirthPulse: {
    gain: 1, minGap: 600, max: 1,
    synth: io => mix(
      tone(io, { f: 523.25, d: .6, peak: .4, a: .03, filter: 3600 }),
      tone(io, { f: 659.25, d: .55, at: .06, peak: .36, filter: 3600 }),
      tone(io, { f: 783.99, d: .5, at: .12, peak: .32, filter: 3800 }),
      tone(io, { f: 1046.5, d: .5, at: .2, peak: .25, filter: 4200 }),
      tone(io, { f: 196, f1: 262, d: .6, peak: .3 }),
      noiseSwell(io, { a: .05, d: .5, cut: 800, cut1: 2600, type: 'highpass', peak: .3 }),
    ),
  },

  // Storm Warrior — electric: sharp squares under high-passed sizzle, thunder underneath.
  /** Q release: the punch flying as a knot of static. */
  swPunch: {
    gain: .65, minGap: 90, max: 3,
    synth: io => mix(
      tone(io, { f: 110, f1: 520, type: 'square', d: .12, peak: .5, filter: 2600 }),
      noiseSwell(io, { a: .002, d: .1, cut: 1200, cut1: 4200, type: 'highpass', peak: .5 }),
      tone(io, { f: 1800, d: .06, at: .05, peak: .2 }),
    ),
  },
  /** Q impact: the electric crack landing with the punch behind it. */
  swPunchHit: {
    gain: .8, minGap: 70, max: 3,
    synth: io => mix(
      noiseSwell(io, { a: .002, d: .08, cut: 2600, cut1: 1000, type: 'highpass', peak: .7 }),
      tone(io, { f: 120, f1: 45, d: .16, peak: .8 }),
      tone(io, { f: 900, f1: 220, type: 'square', d: .1, at: .02, peak: .4, filter: 2200 }),
    ),
  },
  /** W: the field discharging in three staggered zaps over a humming swell. */
  swField: {
    gain: .9, minGap: 200, max: 1,
    synth: io => mix(
      tone(io, { f: 700, f1: 180, type: 'square', d: .08, peak: .4, filter: 3000 }),
      tone(io, { f: 700, f1: 180, type: 'square', d: .08, at: .05, peak: .38, filter: 3000 }),
      tone(io, { f: 700, f1: 180, type: 'square', d: .08, at: .1, peak: .34, filter: 3000 }),
      tone(io, { f: 55, f1: 75, d: .4, peak: .5 }),
      noiseSwell(io, { a: .02, d: .3, cut: 2000, cut1: 600, type: 'highpass', peak: .5 }),
    ),
  },
  /** E build-up: the charge gathering before the leap. */
  swCharge: {
    gain: .7, minGap: 400, max: 1,
    synth: io => mix(
      noiseSwell(io, { a: .05, d: .2, cut: 600, cut1: 3200, type: 'highpass', peak: .55 }),
      tone(io, { f: 60, f1: 150, type: 'square', d: .25, peak: .5, filter: 1500 }),
    ),
  },
  /** E landing: a thunderclap at the end of the charge. */
  swChargeHit: {
    gain: 1, minGap: 300, max: 1,
    synth: io => mix(
      tone(io, { f: 95, f1: 26, d: .6, peak: .95 }),
      noiseSwell(io, { a: .003, d: .5, cut: 3000, cut1: 100, peak: .9 }),
      tone(io, { f: 400, f1: 70, type: 'square', d: .15, at: .1, peak: .45, filter: 1400 }),
      tone(io, { f: 60, f1: 40, d: .7, at: .15, peak: .4 }),
    ),
  },
  /** R activation: the rage roar with three electrical accents crackling through it. */
  swRage: {
    gain: 1, minGap: 600, max: 1,
    synth: io => mix(
      tone(io, { f: 80, f1: 220, type: 'sawtooth', d: .35, peak: .55, filter: 2600 }),
      tone(io, { f: 150, f1: 300, d: .3, at: .05, peak: .4 }),
      noiseSwell(io, { a: .03, d: .6, cut: 400, cut1: 90, peak: .6 }),
      tone(io, { f: 1400, f1: 300, type: 'square', d: .06, at: .15, peak: .3, filter: 3600 }),
      noiseSwell(io, { a: .002, d: .06, at: .15, cut: 3600, cut1: 1400, type: 'highpass', peak: .4 }),
      tone(io, { f: 1600, f1: 350, type: 'square', d: .06, at: .3, peak: .28, filter: 3600 }),
      noiseSwell(io, { a: .002, d: .06, at: .3, cut: 3800, cut1: 1500, type: 'highpass', peak: .36 }),
      tone(io, { f: 1800, f1: 400, type: 'square', d: .06, at: .45, peak: .26, filter: 3600 }),
      noiseSwell(io, { a: .002, d: .06, at: .45, cut: 4000, cut1: 1600, type: 'highpass', peak: .32 }),
    ),
  },
};
