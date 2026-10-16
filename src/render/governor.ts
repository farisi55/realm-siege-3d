/**
 * The pure part of the quality governor (frame times in, level out, no GPU and no Three.js), so the tests can drive it directly.
 * `quality.ts` applies the levels to the renderer.
 */

export interface Level {
  /** Largest pixel ratio (the device ratio is the other limit). */
  dpr: number;
  /** Shadow map size, pixels. */
  shadow: number;
  /** Scale of the draw distance of grass, ferns and flowers. */
  reach: number;
  /** Fireflies drawn. */
  flies: number;
  /** Strength of the rune glow on the ground. */
  rune: number;
  bloom: boolean;
}

/** From the cheapest (0) to the best (3). */
export const LEVELS: readonly Level[] = [
  { dpr: .85, shadow: 1024, reach: .35, flies: 0, rune: .5, bloom: false },
  { dpr: 1.1, shadow: 1024, reach: .6, flies: 48, rune: .56, bloom: true },
  { dpr: 1.5, shadow: 2048, reach: .85, flies: 110, rune: .6, bloom: true },
  { dpr: 2, shadow: 2048, reach: 1, flies: 160, rune: .62, bloom: true },
];
export const MAX_LEVEL = LEVELS.length - 1;

export interface GovernorConfig {
  /** A frame longer than this (ms) is a stall (hidden tab, loading), not a measurement. */
  stall: number;
  /** Smoothing of the frame time average, per frame. */
  smooth: number;
  /** The average above this (ms) counts as too slow ... */
  down: number;
  /** ... for this long (s) before the level drops. */
  downFor: number;
  /** The average below this (ms) counts as headroom ... */
  up: number;
  /** ... for `wait` seconds before the level rises. The wait doubles after a regretted climb, up to `maxWait`. */
  wait: number;
  maxWait: number;
  /** A fall this soon (s) after a climb is a regretted climb. */
  regret: number;
  /** Seconds after start or after a change in which nothing is decided (the new level needs a moment to show its cost). */
  grace: number;
}
export const GOVERNOR: GovernorConfig = { stall: 250, smooth: .08, down: 21, downFor: 1.5, up: 16.9, wait: 12, maxWait: 96, regret: 20, grace: 3 };

export class Governor {
  level: number;
  private locked: number | null = null;
  private ema = 1000 / 60;
  private over = 0;
  private under = 0;
  private age = 0;
  private t = 0;
  private upAt = -1e9;
  private patience: number;

  constructor(readonly max = MAX_LEVEL, start = max, readonly cfg: GovernorConfig = GOVERNOR) {
    this.level = Math.max(0, Math.min(max, start));
    this.patience = cfg.wait;
  }

  get isLocked(): boolean { return this.locked !== null; }
  /** Seconds of headroom currently required before a climb. */
  get wait(): number { return this.patience; }
  /** The smoothed frame time, ms. */
  get average(): number { return this.ema; }

  /** `null`: automatic. A level: fixed (the player's choice, a test, a screenshot). */
  lock(level: number | null): void {
    this.locked = level === null ? null : Math.max(0, Math.min(this.max, Math.round(level)));
    if (this.locked !== null) this.level = this.locked;
    this.reset();
  }

  private reset(): void { this.over = this.under = 0; this.age = 0; this.ema = 1000 / 60; }

  /** Feeds one frame (ms since the previous frame); returns the level to draw at. */
  sample(ms: number): number {
    if (this.locked !== null) return this.level;
    const c = this.cfg;
    if (!(ms > 0) || ms > c.stall) return this.level;
    const s = ms / 1000;
    this.t += s; this.age += s;
    this.ema += (ms - this.ema) * c.smooth;
    if (this.age < c.grace) return this.level;
    if (this.ema > c.down) { this.over += s; this.under = 0; }
    else {
      this.over = Math.max(0, this.over - s);
      if (this.ema < c.up) this.under += s; else this.under = Math.max(0, this.under - s * 2);
    }
    if (this.over >= c.downFor && this.level > 0) {
      this.level--;
      if (this.t - this.upAt < c.regret) this.patience = Math.min(c.maxWait, this.patience * 2);
      this.reset();
    } else if (this.under >= this.patience && this.level < this.max) {
      this.level++; this.upAt = this.t;
      this.reset();
    }
    return this.level;
  }
}
