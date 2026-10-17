import { ST } from '../game/storage';

/**
 * The audio engine: one AudioContext, five gain buses (master feeds the speakers, `sfx` / `music` / `ambient` / `ui` feed
 * master), a small voice registry, an asset cache with a synthesized fallback and localStorage-backed volumes. It knows
 * nothing about the game, React or the DOM: gameplay and UI code reach it through the facade in `audio.ts`.
 *
 * Rules (mirroring the VFX system):
 *  - No node is built for a sound that cannot be heard (before the first user gesture, while muted, on a silent bus, over the voice cap).
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
/** Controls one sustained voice started by `startLoop`: `stop` is idempotent and never throws. */
export interface LoopHandle { name: string; stop(): void }

export interface SoundDef {
  /** Built-in fallback voice, used whenever no file has been loaded for this name. */
  synth?: SynthFn;
  /** Optional files tried in order by `load()` / `preload()`; the first that loads replaces the synth. */
  urls?: string[];
  /** Voice gain before the bus (default 1). */
  gain?: number;
  /** Minimum ms between two plays of this sound: swallows duplicate events and double clicks. */
  minGap?: number;
  /** Concurrent-voice cap for this sound: keeps a swarm of identical impacts from stacking (default: global cap only). */
  max?: number;
  /** Sustained voice: started with `startLoop`, lives until stopped (a loaded file loops; synth voices fade out on their own). */
  loop?: boolean;
}

/** `rate` shifts pitch (clamped .5..2); `force` marks a priority event that bypasses `minGap` and `max`. */
export interface PlayOptions { gain?: number; rate?: number; force?: boolean }

export interface AudioPrefs { master: number; sfx: number; music: number; ambient: number; ui: number; muted: boolean }

export interface AudioSnapshot {
  played: number; dropped: number; failed: number; active: number;
  state: AudioContextState | 'none'; unlocked: boolean; gesture: boolean;
  buses: Record<Bus, number>; levels: Record<Bus, number>; muted: boolean;
}

interface Voice { bus: Bus; name: string; stop: StopFn }

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
  private voices = new Set<Voice>();
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | null>>();
  private noise: AudioBuffer | null = null;
  private lastAt = new Map<string, number>();
  private vols: Record<Bus, number>;
  private mutedFlag: boolean;
  /** True once a real user gesture has been seen: the only state in which a voice may be started. */
  private seen = false;

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

  private buildBuses(): void {
    const ctx = this.ctx!;
    this.buses.clear();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.buses.set('master', master);
    for (const b of BUSES) {
      if (b === 'master') continue;
      const g = ctx.createGain();
      g.connect(master);
      this.buses.set(b, g);
    }
    this.applyVolumes();
  }

  private busGain(b: Bus): number { return b === 'master' ? (this.mutedFlag ? 0 : this.vols.master) : this.vols[b]; }

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

  // -------------------------------------------------------------------------------------------------------------- playing

  /**
   * Plays `name` on `bus`. Returns false (never throws) when: the sound is unknown, no user gesture has been seen yet,
   * the master or the bus is silent, the sound is inside its minGap or over its per-sound `max`, the voice cap is
   * reached, or Web Audio is unavailable. `force` marks a priority event (the player's own actions, structure losses):
   * it bypasses the gap and per-sound caps. A loaded file wins; otherwise the synthesized voice is used.
   */
  play(bus: Bus, name: string, opts: PlayOptions = {}): boolean {
    const def = this.sounds[name];
    if (!def || (!def.synth && !def.urls?.length)) { this.stats.failed++; return false; }
    if (!this.seen && !this.unlocked) { this.stats.dropped++; return false; } // autoplay: nothing is audible before the first gesture
    if (this.mutedFlag || this.vols.master <= 0 || this.vols[bus] <= 0) return false; // inaudible: do not build nodes
    if (def.minGap) {
      const now = nowMs(), last = this.lastAt.get(name);
      if (!opts.force && last !== undefined && now - last < def.minGap) return false;
      this.lastAt.set(name, now);
    }
    if (!opts.force && def.max !== undefined && this.count(name) >= def.max) { this.stats.dropped++; return false; }
    if (this.voices.size >= this.maxVoices) { this.stats.dropped++; return false; }
    const ctx = this.ensure();
    if (!ctx) { this.stats.failed++; return false; }
    if (ctx.state === 'suspended') this.resume(); // a gesture was seen: the queued voice starts on resume
    const dest = this.buses.get(bus) ?? this.buses.get('master');
    if (!dest) { this.stats.failed++; return false; }
    const gain = Math.max(0, (def.gain ?? 1) * (opts.gain ?? 1));
    const rate = Math.min(2, Math.max(.5, opts.rate ?? 1)); // pitch variation, in tune-safe bounds
    const buffer = this.buffers.get(name);

    // The voice object exists before the nodes do: a synth wires `io.done` to it so the registry never leaks.
    const voice: Voice = { bus, name, stop: () => { /* replaced below */ } };
    let ended = false;
    const done = (): void => { ended = true; this.voices.delete(voice); };
    try {
      if (buffer) voice.stop = this.playBuffer(ctx, dest, buffer, gain, rate);
      else if (def.synth) {
        const io: SynthIo = { ctx, dest, t0: ctx.currentTime + .005, gain, rate, noise: this.noiseBuffer(ctx), done };
        voice.stop = def.synth(io) ?? voice.stop;
      } else { this.stats.failed++; return false; }
    } catch { this.stats.failed++; return false; }
    if (ended) return false; // the voice finished while being built (degenerate): nothing left to track
    this.voices.add(voice);
    this.stats.played++;
    return true;
  }

  /**
   * Starts a sustained voice (`def.loop`) that lives until `handle.stop()` or its own internal fade. Same gates as
   * `play()` (gesture, mute, silent bus, `max`, voice cap), minus the minGap — loops are long-lived, not bursts.
   * Returns a handle, or null when nothing could start. Used by the ability layer for the Burning Zone fire bed.
   */
  startLoop(bus: Bus, name: string, opts: PlayOptions = {}): LoopHandle | null {
    const def = this.sounds[name];
    if (!def || (!def.synth && !def.urls?.length)) { this.stats.failed++; return null; }
    if (!this.seen && !this.unlocked) { this.stats.dropped++; return null; }
    if (this.mutedFlag || this.vols.master <= 0 || this.vols[bus] <= 0) return null;
    if (!opts.force && def.max !== undefined && this.count(name) >= def.max) { this.stats.dropped++; return null; }
    if (this.voices.size >= this.maxVoices) { this.stats.dropped++; return null; }
    const ctx = this.ensure();
    if (!ctx) { this.stats.failed++; return null; }
    if (ctx.state === 'suspended') this.resume();
    const dest = this.buses.get(bus) ?? this.buses.get('master');
    if (!dest) { this.stats.failed++; return null; }
    const gain = Math.max(0, (def.gain ?? 1) * (opts.gain ?? 1));
    const rate = Math.min(2, Math.max(.5, opts.rate ?? 1));
    const buffer = this.buffers.get(name);
    const voice: Voice = { bus, name, stop: () => { /* replaced below */ } };
    const done = (): void => { this.voices.delete(voice); };
    try {
      if (buffer) voice.stop = this.playBuffer(ctx, dest, buffer, gain, rate, true);
      else if (def.synth) {
        const io: SynthIo = { ctx, dest, t0: ctx.currentTime + .005, gain, rate, noise: this.noiseBuffer(ctx), done };
        voice.stop = def.synth(io) ?? voice.stop;
      } else { this.stats.failed++; return null; }
    } catch { this.stats.failed++; return null; }
    this.voices.add(voice);
    this.stats.played++;
    let live = true;
    return {
      name,
      stop: (): void => { if (!live) return; live = false; this.voices.delete(voice); try { voice.stop(); } catch { /* already stopped */ } },
    };
  }

  /** How many voices of one sound (or all, when called without a name) are live right now. Backs `SoundDef.max`. */
  count(name?: string): number {
    let n = 0;
    for (const v of this.voices) if (name === undefined || v.name === name) n++;
    return n;
  }

  /** A decoded file on its own gain, straight into the bus. `loop` sustains it until `stop` (startLoop path). */
  private playBuffer(ctx: AudioContext, dest: AudioNode, buffer: AudioBuffer, gain: number, rate: number, loop = false): StopFn {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buffer;
    src.loop = loop;
    src.playbackRate.value = rate;
    g.gain.value = gain;
    src.connect(g); g.connect(dest);
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

  /** Stops every voice (`bus` limits it to one bus) and clears the registry. */
  stopAll(bus?: Bus): void {
    for (const v of [...this.voices]) {
      if (bus && v.bus !== bus) continue;
      this.voices.delete(v);
      try { v.stop(); } catch { /* already stopped */ }
    }
  }

  // -------------------------------------------------------------------------------------------------------------- assets

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
    this.buses.clear();
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') safely(() => ctx.close());
    this.buffers.clear(); this.pending.clear(); this.lastAt.clear();
    this.noise = null; this.seen = false;
  }

  snapshot(): AudioSnapshot {
    return {
      ...this.stats, active: this.voices.size, state: this.ctx ? this.ctx.state : 'none', unlocked: this.unlocked, gesture: this.seen,
      buses: { ...this.vols }, levels: this.levels(), muted: this.mutedFlag,
    };
  }
}
