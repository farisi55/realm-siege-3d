import { ST } from '../game/storage';

/**
 * The audio engine: one AudioContext, five gain buses (master feeds the speakers through a fixed protection chain — a
 * 30 Hz high-pass, a gentle high-shelf and a soft limiter — while `sfx` / `music` / `ambient` / `ui` feed master), a
 * small voice registry, an asset cache with a synthesized fallback and localStorage-backed volumes. It knows nothing
 * about the game, React or the DOM: gameplay and UI code reach it through the facade in `audio.ts`.
 *
 * Rules (mirroring the VFX system):
 *  - No node is built for a sound that cannot be heard (before the first user gesture, while muted, on a silent bus,
 *    over the voice cap — priority `force` plays and the `ui` bus are exempt, so a saturated fight never swallows the
 *    player's own cues or a control click).
 *  - Playing never fetches: files are loaded once by `load()` / `preload()` and cached; everything else plays a synthesized voice.
 *  - Every entry point is safe: no Web Audio, a suspended context or a failed decode never throw into gameplay.
 */

export type Bus = 'master' | 'sfx' | 'music' | 'ambient' | 'ui';
export const BUSES: readonly Bus[] = ['master', 'sfx', 'music', 'ambient', 'ui'];

/** Where each bus volume is persisted (ST adds its `rs_` prefix). */
const STORE_KEY: Record<Bus, string> = { master: 'vol', sfx: 'vol_sfx', music: 'vol_music', ambient: 'vol_amb', ui: 'vol_ui' };
export const DEFAULT_VOLUME: Record<Bus, number> = { master: .8, sfx: .9, music: .6, ambient: .7, ui: .9 };

/** What a synth voice is handed: where to connect, when to start, and the shared resources it must not allocate itself. */
export interface SynthIo {
  ctx: AudioContext;
  /** The bus gain the voice connects to. */
  dest: AudioNode;
  /** Context time to start at (slightly ahead, so nothing is scheduled in the past). */
  t0: number;
  /** Sound-definition gain * caller gain. */
  gain: number;
  /** Pitch multiplier (1 = written pitch), so one recipe covers many subtly different events. */
  rate: number;
  /** One shared noise buffer for every voice of the page. */
  noise: AudioBuffer;
  /** Tell the manager the voice is over (idempotent; wire it to `onended`). */
  done: () => void;
}

/** Stops a voice early (idempotent; never throws). */
export type StopFn = () => void;
/** A synthesized voice: builds its nodes, starts them, returns its stop function. */
export type SynthFn = (io: SynthIo) => StopFn;
/**
 * Controls one sustained voice started by `startLoop`: `stop` is idempotent and never throws, `live` reports whether
 * the voice is still sounding — the world layers watch it to restart a bed that faded out or to replace one that a
 * `stopAll` took down.
 */
export interface LoopHandle { name: string; readonly live: boolean; stop(): void }

export interface SoundDef {
  /** Built-in fallback voice, used whenever no file has been loaded for this name. */
  synth?: SynthFn;
  /** Optional files tried in order by `load()` / `preload()`; the first that loads replaces the synth. */
  urls?: string[];
  /** Voice gain before the bus (default 1). */
  gain?: number;
  /** Gain used instead of `gain` when a decoded file plays (the pack's `recommendedVolume`); the synth keeps its own mix level. */
  fileGain?: number;
  /** Minimum ms between two plays of this sound: swallows duplicate events and double clicks. */
  minGap?: number;
  /** Concurrent-voice cap for this sound: keeps a swarm of identical impacts from stacking (default: global cap only). */
  max?: number;
  /** Sustained voice: started with `startLoop`, lives until stopped (a loaded file loops; synth voices fade out on their own). */
  loop?: boolean;
  /**
   * Spatial falloff reference distance in world units: a `pos`-carrying play is full volume within it and falls off as
   * ~1/(1+(d/ref)^2) beyond. Only defs that want engine attenuation set it (music, ambience, footsteps); the combat
   * mix keeps its own gain and uses `pos` for panning only.
   */
  ref?: number;
  /** Spatial cutoff in world units: a `pos`-carrying play farther than this from the listener is dropped before any node is built. */
  maxDist?: number;
}

/** `rate` shifts pitch (clamped .5..2); `force` marks a priority event that bypasses `minGap` and `max`; `pos` places the voice in the world (see `setListener`). */
export interface PlayOptions { gain?: number; rate?: number; force?: boolean; pos?: { x: number; y: number } }

export interface AudioPrefs { master: number; sfx: number; music: number; ambient: number; ui: number; muted: boolean }

export interface AudioSnapshot {
  played: number; dropped: number; failed: number; active: number;
  state: AudioContextState | 'none'; unlocked: boolean; gesture: boolean;
  buses: Record<Bus, number>; levels: Record<Bus, number>; muted: boolean; duck: number; listener: boolean;
}

interface Voice { bus: Bus; name: string; stop: StopFn; spat?: SpatialVoice }

/** One live positional voice: its world point and the nodes the listener moves (null when that node was not needed or cannot be built). */
interface SpatialVoice { name: string; x: number; y: number; pan: StereoPannerNode | null; vg: GainNode | null }

const nowMs = (): number => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const num = (key: string, d: number): number => {
  const v = ST.get(key, d);
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : d;
};
/** Runs a call that may reject asynchronously (context.resume/close): a refused promise stays silent. */
const safely = (fn: () => unknown): void => {
  try { const r = fn() as any; if (r && typeof r.catch === 'function') r.catch(() => { /* refused: stay silent */ }); }
  catch { /* unavailable: stay silent */ }
};

export class AudioManager {
  /** Hard cap on audible voices at once; beyond it new plays are dropped and counted. */
  maxVoices = 32;
  /** How long `load()` waits for a file before giving up (the synth keeps playing). */
  timeoutMs = 8000;
  /** Counters for the debug hook and the tests. */
  readonly stats = { played: 0, dropped: 0, failed: 0 };

  private ctx: AudioContext | null = null;
  private buses = new Map<Bus, GainNode>();
  /** Fixed nodes between master and the speakers (high-pass, high-shelf, limiter); torn down with the context. */
  private chain: AudioNode[] = [];
  private voices = new Set<Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private noise: AudioBuffer | null = null;
  private lastAt = new Map<string, number>();
  private vols: Record<Bus, number>;
  private mutedFlag: boolean;
  /** True once a real user gesture has been seen: the only state in which a voice may be started. */
  private seen = false;
  /** The listening point the world layers push every frame (camera focus + yaw); null until a game sets one. */
  private lis: { x: number; y: number; rx: number; ry: number } | null = null;
  /** Live positional voices, re-placed whenever the listener moves (ambience beds, footsteps, panned one-shots). */
  private spatial = new Set<SpatialVoice>();
  /** Temporary gain scale for the gameplay buses (pause ducks the world, never the UI). */
  private duckScale = 1;

  constructor(private readonly sounds: Record<string, SoundDef> = {}) {
    this.vols = {
      master: num('vol', DEFAULT_VOLUME.master), sfx: num('vol_sfx', DEFAULT_VOLUME.sfx), music: num('vol_music', DEFAULT_VOLUME.music),
      ambient: num('vol_amb', DEFAULT_VOLUME.ambient), ui: num('vol_ui', DEFAULT_VOLUME.ui),
    };
    this.mutedFlag = ST.get('mute', false) === true;
  }

  // -------------------------------------------------------------------------------------------------------------- context

  /** A user gesture was seen (the facade wires pointer/key listeners): allows voices and tries to resume a suspended context. */
  gesture(): void {
    this.seen = true;
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') this.resume();
  }

  /** True once the context exists and is running. */
  get unlocked(): boolean { return !!this.ctx && this.ctx.state === 'running'; }

  /** Creates the context and the bus graph on first use. Returns null when Web Audio is unavailable (never throws). */
  ensure(): AudioContext | null {
    if (this.ctx && this.ctx.state !== 'closed') return this.ctx;
    const C: typeof AudioContext | undefined = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!C) return null;
    try { this.ctx = new C(); } catch { this.ctx = null; return null; }
    this.buildBuses();
    return this.ctx;
  }

  /** Suspends the context (hidden tab). Safe to call at any time. */
  suspend(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    safely(() => ctx.suspend());
  }

  /** Resumes a suspended context, but only after a user gesture has been seen (autoplay rules). */
  resume(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'suspended' || !this.seen) return;
    safely(() => ctx.resume());
  }

  /**
   * The fixed master protection chain, built right to left (high-pass -> high-shelf -> limiter -> speakers) and
   * returned by its head. Missing node types (ancient or minimal contexts) are skipped, so the graph degrades to a
   * straight wire instead of failing — playing must never depend on an optional node existing.
   */
  private masterChain(ctx: AudioContext): AudioNode {
    let out: AudioNode = ctx.destination;
    // Soft limiter: the last line before the speakers. A high threshold and a steep ratio mean only stacked peaks are
    // held back — stacked ultimates, a collapsing core and a victory fanfare never clip the output.
    if (typeof ctx.createDynamicsCompressor === 'function') {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -2; lim.knee.value = 1; lim.ratio.value = 12; lim.attack.value = .002; lim.release.value = .25;
      lim.connect(out); out = lim; this.chain.push(lim);
    }
    if (typeof ctx.createBiquadFilter === 'function') {
      // Gentle high-shelf: stacked lightning and magical sizzle stays readable instead of turning shrill.
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 9000; shelf.gain.value = -2.5;
      shelf.connect(out); out = shelf; this.chain.push(shelf);
      // High-pass at 30 Hz: rumble below hearing is removed before it can eat the headroom the limiter holds back.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 30; hp.Q.value = .5;
      hp.connect(out); out = hp; this.chain.push(hp);
    }
    return out;
  }

  private buildBuses(): void {
    const ctx = this.ctx!;
    this.buses.clear();
    for (const n of this.chain) { try { n.disconnect(); } catch { /* already gone */ } }
    this.chain = [];
    const master = ctx.createGain();
    master.connect(this.masterChain(ctx));
    this.buses.set('master', master);
    for (const b of BUSES) {
      if (b === 'master') continue;
      const g = ctx.createGain();
      g.connect(master);
      this.buses.set(b, g);
    }
    this.applyVolumes();
  }

  private busGain(b: Bus): number {
    if (b === 'master') return this.mutedFlag ? 0 : this.vols.master;
    if (b === 'ui') return this.vols.ui; // controls stay at their set level: a duck never muffles the menus
    return this.vols[b] * this.duckScale;
  }

  private applyVolumes(): void {
    for (const b of BUSES) this.setParam(this.buses.get(b)?.gain, this.busGain(b));
  }

  private setParam(p: AudioParam | undefined, v: number): void {
    if (!p) return;
    try { p.cancelScheduledValues(0); p.setValueAtTime(v, this.ctx?.currentTime ?? 0); }
    catch { try { p.value = v; } catch { /* the param is gone */ } }
  }

  // -------------------------------------------------------------------------------------------------------------- volume

  getVolume(bus: Bus): number { return this.vols[bus]; }
  isMuted(): boolean { return this.mutedFlag; }

  /** Sets one bus volume (clamped to 0..1) and persists it. Master volume 0 or mute silences everything immediately. */
  setVolume(bus: Bus, v: number): void {
    if (!Number.isFinite(v)) return;
    this.vols[bus] = clamp01(v);
    ST.set(STORE_KEY[bus], this.vols[bus]);
    this.applyVolumes();
  }

  /** Mutes/unmutes every bus at once (master gain 0) and persists the choice. */
  setMuted(m: boolean): void {
    this.mutedFlag = !!m;
    ST.set('mute', this.mutedFlag);
    this.applyVolumes();
  }

  /** Back to the defaults in memory (the caller clears the stored keys first). */
  reset(): void {
    this.vols = { ...DEFAULT_VOLUME };
    this.mutedFlag = false;
    this.applyVolumes();
  }

  /** The settings UI reads this. */
  prefs(): AudioPrefs {
    const { master, sfx, music, ambient, ui } = this.vols;
    return { master, sfx, music, ambient, ui, muted: this.mutedFlag };
  }

  /** Current gain-node values per bus (debug/tests): what the graph actually sees; -1 when there is no context yet. */
  levels(): Record<Bus, number> {
    const o = {} as Record<Bus, number>;
    for (const b of BUSES) o[b] = this.buses.get(b)?.gain.value ?? -1;
    return o;
  }

  // -------------------------------------------------------------------------------------------------------------- spatial

  /**
   * Moves the listener: the world layers call this once per frame with the camera focus and yaw. Voices carrying a
   * `pos` pan by the source direction against the camera's right vector and follow the listener as it moves. The
   * derived `rx`/`ry` is the ground direction that appears rightward on screen for that yaw (see `render/camrig.ts`).
   */
  setListener(x: number, y: number, yaw: number): void {
    this.lis = { x, y, rx: Math.cos(yaw), ry: -Math.sin(yaw) };
    this.applySpatial();
  }

  /** True once a listener has been placed (debug/tests). */
  hasListener(): boolean { return !!this.lis; }

  /** How much a def's spatial falloff would attenuate one world point right now (1 without a listener or a `ref`). */
  attenuationAt(name: string, x: number, y: number): number {
    const def = this.sounds[name];
    if (!def?.ref || !this.lis) return 1;
    const d = Math.hypot(x - this.lis.x, y - this.lis.y);
    return 1 / (1 + (d / def.ref) ** 2);
  }

  /** The live positional voices with their current pan and falloff gain (debug/tests). */
  spatialVoices(): { name: string; x: number; y: number; pan: number; gain: number }[] {
    return [...this.spatial].map(s => ({ name: s.name, x: s.x, y: s.y, pan: s.pan ? s.pan.pan.value : 0, gain: s.vg ? s.vg.gain.value : 1 }));
  }

  /**
   * Temporary gain scale applied to `sfx` / `music` / `ambient` — never `ui` and never the stored volumes: pausing
   * ducks the world to a whisper while the menus stay crisp; `1` restores it. Persisting nothing keeps settings honest.
   */
  setDuck(scale: number): void {
    const v = clamp01(scale);
    if (v === this.duckScale) return;
    this.duckScale = v;
    this.applyVolumes();
  }
  get duck(): number { return this.duckScale; }

  /** Where a `pos`-carrying voice sits relative to the listener. Null when nothing positional applies (no listener,
   * no position, or the UI bus — controls stay centered); false when the def's cutoff culls the play outright. */
  private spatialFor(def: SoundDef, bus: Bus, pos?: { x: number; y: number }): { att: number; pan: number } | null | false {
    const L = this.lis;
    if (!pos || !L || bus === 'ui') return null;
    const dx = pos.x - L.x, dy = pos.y - L.y, d = Math.hypot(dx, dy);
    if (def.maxDist !== undefined && d > def.maxDist) return false;
    const pan = d > 1 ? Math.max(-1, Math.min(1, (dx * L.rx + dy * L.ry) / d)) : 0;
    if (def.ref === undefined && pan === 0) return null; // nothing to move: play it as a normal, centered voice
    return { att: def.ref === undefined ? 1 : 1 / (1 + (d / def.ref) ** 2), pan };
  }

  /** Builds the output chain of a positional voice: bus ← panner? ← falloff gain?, and the gain the synth should use. */
  private buildSpatial(ctx: AudioContext, busDest: AudioNode, sp: { att: number; pan: number }, def: SoundDef, base: number): { dest: AudioNode; pan: StereoPannerNode | null; vg: GainNode | null; gain: number } {
    let dest = busDest, pan: StereoPannerNode | null = null, vg: GainNode | null = null, gain = base * sp.att;
    if (typeof ctx.createStereoPanner === 'function') {
      // Always give a positional voice a panner — even one that starts dead ahead — so the listener can pan it later.
      pan = ctx.createStereoPanner();
      pan.pan.value = sp.pan;
      pan.connect(dest);
      dest = pan;
    }
    if (def.ref !== undefined) {
      vg = ctx.createGain();
      gain = base; // the falloff lives on its own node so the listener can keep moving the voice
      vg.gain.value = sp.att;
      vg.connect(dest);
      dest = vg;
    }
    return { dest, pan, vg, gain };
  }

  /** Re-places every live positional voice after the listener moved: pan first, then the falloff gain for `ref` defs. */
  private applySpatial(): void {
    const L = this.lis;
    if (!L) return;
    for (const s of this.spatial) {
      const dx = s.x - L.x, dy = s.y - L.y, d = Math.hypot(dx, dy);
      if (s.pan) this.setParam(s.pan.pan, d > 1 ? Math.max(-1, Math.min(1, (dx * L.rx + dy * L.ry) / d)) : 0);
      if (s.vg) {
        const ref = this.sounds[s.name]?.ref;
        this.setParam(s.vg.gain, ref ? 1 / (1 + (d / ref) ** 2) : 1);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------- playing

  /**
   * Plays `name` on `bus`. Returns false (never throws) when: the sound is unknown, no user gesture has been seen yet,
   * the master or the bus is silent, the sound is inside its minGap or over its per-sound `max`, the voice cap is
   * reached (priority `force` plays and the `ui` bus are exempt and may exceed it), or Web Audio is unavailable.
   * `force` marks a priority event (the player's own actions, structure losses): it bypasses the gap and per-sound
   * caps. A loaded file wins; otherwise the synthesized voice is used.
   */
  play(bus: Bus, name: string, opts: PlayOptions = {}): boolean {
    const def = this.sounds[name];
    if (!def || (!def.synth && !def.urls?.length)) { this.stats.failed++; return false; }
    if (!this.seen && !this.unlocked) { this.stats.dropped++; return false; } // autoplay: nothing is audible before the first gesture
    if (this.mutedFlag || this.vols.master <= 0 || this.vols[bus] <= 0) return false; // inaudible: do not build nodes
    const sp = this.spatialFor(def, bus, opts.pos); // false: beyond the def's cutoff, culled before any node exists
    if (sp === false) { this.stats.dropped++; return false; }
    if (def.minGap) {
      const now = nowMs(), last = this.lastAt.get(name);
      if (!opts.force && last !== undefined && now - last < def.minGap) return false;
      this.lastAt.set(name, now);
    }
    if (!opts.force && def.max !== undefined && this.count(name) >= def.max) { this.stats.dropped++; return false; }
    if (this.voices.size >= this.maxVoices && !opts.force && bus !== 'ui') { this.stats.dropped++; return false; }
    const ctx = this.ensure();
    if (!ctx) { this.stats.failed++; return false; }
    if (ctx.state === 'suspended') this.resume(); // a gesture was seen: the queued voice starts on resume
    const busDest = this.buses.get(bus) ?? this.buses.get('master');
    if (!busDest) { this.stats.failed++; return false; }
    const buffer = this.buffers.get(name);
    // A loaded file plays at its own gain (`fileGain`, the pack's recommended volume); the synth keeps `gain`.
    const base = Math.max(0, ((buffer ? def.fileGain ?? def.gain : def.gain) ?? 1) * (opts.gain ?? 1));
    const rate = Math.min(2, Math.max(.5, opts.rate ?? 1)); // pitch variation, in tune-safe bounds
    // Positional voices get a pan node (when the engine can pan) and, for `ref` defs, a gain node the listener can move.
    const chain = sp ? this.buildSpatial(ctx, busDest, sp, def, base) : { dest: busDest, pan: null, vg: null, gain: base };

    // The voice object exists before the nodes do: a synth wires `io.done` to it so the registry never leaks.
    const voice: Voice = { bus, name, stop: () => { /* replaced below */ } };
    let ended = false;
    const done = (): void => { ended = true; this.voices.delete(voice); if (voice.spat) this.spatial.delete(voice.spat); };
    try {
      if (buffer) voice.stop = this.playBuffer(ctx, chain.dest, buffer, chain.gain, rate, false, done);
      else if (def.synth) {
        const io: SynthIo = { ctx, dest: chain.dest, t0: ctx.currentTime + .005, gain: chain.gain, rate, noise: this.noiseBuffer(ctx), done };
        voice.stop = def.synth(io) ?? voice.stop;
      } else { this.stats.failed++; return false; }
    } catch { this.stats.failed++; return false; }
    if (ended) return false; // the voice finished while being built (degenerate): nothing left to track
    if (sp) { voice.spat = { name, x: opts.pos!.x, y: opts.pos!.y, pan: chain.pan, vg: chain.vg }; this.spatial.add(voice.spat); }
    this.voices.add(voice);
    this.stats.played++;
    return true;
  }

  /**
   * Starts a sustained voice (`def.loop`) that lives until `handle.stop()` or its own internal fade. Same gates as
   * `play()` (gesture, mute, silent bus, `max`, voice cap — priority `force` plays may exceed the cap), minus the
   * minGap — loops are long-lived, not bursts.
   * Returns a handle, or null when nothing could start. Used by the world layer for music beds and ambience.
   */
  startLoop(bus: Bus, name: string, opts: PlayOptions = {}): LoopHandle | null {
    const def = this.sounds[name];
    if (!def || (!def.synth && !def.urls?.length)) { this.stats.failed++; return null; }
    if (!this.seen && !this.unlocked) { this.stats.dropped++; return null; }
    if (this.mutedFlag || this.vols.master <= 0 || this.vols[bus] <= 0) return null;
    const sp = this.spatialFor(def, bus, opts.pos); // false: beyond the def's cutoff, culled before any node exists
    if (sp === false) { this.stats.dropped++; return null; }
    if (!opts.force && def.max !== undefined && this.count(name) >= def.max) { this.stats.dropped++; return null; }
    if (this.voices.size >= this.maxVoices && !opts.force && bus !== 'ui') { this.stats.dropped++; return null; }
    const ctx = this.ensure();
    if (!ctx) { this.stats.failed++; return null; }
    if (ctx.state === 'suspended') this.resume();
    const busDest = this.buses.get(bus) ?? this.buses.get('master');
    if (!busDest) { this.stats.failed++; return null; }
    const buffer = this.buffers.get(name);
    const base = Math.max(0, ((buffer ? def.fileGain ?? def.gain : def.gain) ?? 1) * (opts.gain ?? 1));
    const rate = Math.min(2, Math.max(.5, opts.rate ?? 1));
    const chain = sp ? this.buildSpatial(ctx, busDest, sp, def, base) : { dest: busDest, pan: null, vg: null, gain: base };
    const voice: Voice = { bus, name, stop: () => { /* replaced below */ } };
    const done = (): void => { this.voices.delete(voice); if (voice.spat) this.spatial.delete(voice.spat); };
    try {
      if (buffer) voice.stop = this.playBuffer(ctx, chain.dest, buffer, chain.gain, rate, true, done);
      else if (def.synth) {
        const io: SynthIo = { ctx, dest: chain.dest, t0: ctx.currentTime + .005, gain: chain.gain, rate, noise: this.noiseBuffer(ctx), done };
        voice.stop = def.synth(io) ?? voice.stop;
      } else { this.stats.failed++; return null; }
    } catch { this.stats.failed++; return null; }
    this.voices.add(voice);
    if (sp) { voice.spat = { name, x: opts.pos!.x, y: opts.pos!.y, pan: chain.pan, vg: chain.vg }; this.spatial.add(voice.spat); }
    this.stats.played++;
    const owner = this;
    let live = true;
    return {
      name,
      get live() { return live && owner.voices.has(voice); },
      stop: (): void => {
        if (!live) return;
        live = false;
        this.voices.delete(voice);
        if (voice.spat) this.spatial.delete(voice.spat);
        try { voice.stop(); } catch { /* already stopped */ }
      },
    };
  }

  /** How many voices of one sound (or all, when called without a name) are live right now. Backs `SoundDef.max`. */
  count(name?: string): number {
    let n = 0;
    for (const v of this.voices) if (name === undefined || v.name === name) n++;
    return n;
  }

  /**
   * A decoded file on its own gain, straight into the bus. `loop` sustains it until `stop` (startLoop path); `done`
   * is wired to `onended`, so a file that finishes naturally (or is stopped) leaves the voice registry behind it —
   * a loaded one-shot never stays registered as a phantom voice.
   */
  private playBuffer(ctx: AudioContext, dest: AudioNode, buffer: AudioBuffer, gain: number, rate: number, loop = false, done?: () => void): StopFn {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    g.gain.value = gain;
    src.connect(g); g.connect(dest);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* already gone */ } done?.(); };
    src.start(ctx.currentTime + .005);
    return () => { try { src.stop(); } catch { /* not started */ } try { src.disconnect(); g.disconnect(); } catch { /* already gone */ } };
  }

  /** One noise buffer for the page; voices never allocate their own. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      const n = Math.max(1, Math.floor(ctx.sampleRate * .5)), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
    }
    return this.noise;
  }

  /** Stops every voice (`bus` limits it to one bus) and clears the registry, including the spatial placements. */
  stopAll(bus?: Bus): void {
    for (const v of [...this.voices]) {
      if (bus && v.bus !== bus) continue;
      this.voices.delete(v);
      if (v.spat) this.spatial.delete(v.spat);
      try { v.stop(); } catch { /* already stopped */ }
    }
  }

  // -------------------------------------------------------------------------------------------------------------- assets

  /** True when a decoded file is cached for `name` — the shipped pack replaced this voice's synthesizer. */
  hasAsset(name: string): boolean { return this.buffers.has(name); }

  /** Loads and caches one file for a sound name. Resolves to null (never rejects) when it is missing or undecodable. */
  load(name: string, url: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(name);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(name);
    if (pending) return pending;
    const job = this.fetchBuffer(url).then(buf => { if (buf) this.buffers.set(name, buf); return buf; }).finally(() => this.pending.delete(name));
    this.pending.set(name, job);
    return job;
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ensure();
    if (!ctx || typeof fetch !== 'function') return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ctl = new AbortController();
      timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch { return null; } finally { clearTimeout(timer); }
  }

  /** Tries the configured files of every definition that has them; call once at boot. Returns how many loaded. */
  async preload(): Promise<number> {
    let found = 0;
    await Promise.all(Object.entries(this.sounds).map(async ([name, def]) => {
      for (const url of def.urls ?? []) if (await this.load(name, url)) { found++; break; }
    }));
    return found;
  }

  // -------------------------------------------------------------------------------------------------------------- lifecycle / debug

  /** Stops everything, tears the graph down and closes the context (page cleanup; the manager can be reused afterwards). */
  dispose(): void {
    this.stopAll();
    for (const g of this.buses.values()) { try { g.disconnect(); } catch { /* already gone */ } }
    for (const n of this.chain) { try { n.disconnect(); } catch { /* already gone */ } }
    this.buses.clear();
    this.chain = [];
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') safely(() => ctx.close());
    this.buffers.clear(); this.pending.clear(); this.lastAt.clear();
    this.noise = null; this.seen = false;
    this.lis = null; this.spatial.clear(); this.duckScale = 1;
  }

  snapshot(): AudioSnapshot {
    return {
      ...this.stats, active: this.voices.size, state: this.ctx ? this.ctx.state : 'none', unlocked: this.unlocked, gesture: this.seen,
      buses: { ...this.vols }, levels: this.levels(), muted: this.mutedFlag, duck: this.duckScale, listener: !!this.lis,
    };
  }
}
