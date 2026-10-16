import * as THREE from 'three';

/**
 * Character animation: clip vocabulary, procedural clip authoring, GLB clip mapping,
 * a pure state machine and a controller that drives one AnimationMixer with interruption-safe cross-fades.
 *
 * Conventions for the procedural rig (it faces +Z, y up): a negative X rotation swings a hanging limb forward / raises an arm,
 * a positive X rotation on a shin bends the knee, a negative X rotation on a forearm bends the elbow, a positive X rotation on
 * the spine leans forward. "L" bones sit on +X, "R" bones on -X.
 */

export type AnimState = 'IDLE' | 'WALK' | 'RUN' | 'ATTACK' | 'ATTACK_2' | 'HIT' | 'CAST' | 'CHANNEL' | 'STUN' | 'DEATH' | 'RESPAWN' | 'VICTORY';
export type ClipKey = 'idle' | 'walk' | 'run' | 'attack' | 'attack2' | 'hit' | 'cast' | 'channel' | 'stun' | 'death' | 'respawn' | 'victory';
export type ClipSet = Record<ClipKey, THREE.AnimationClip>;
/** Animation personality of a rig: 'robe' is 'staff' with a short, gliding gait for characters in long robes. */
export type ClipStyle = 'blade' | 'smash' | 'dual' | 'staff' | 'robe' | 'beast';

export const ANIM_STATES: AnimState[] = ['IDLE', 'WALK', 'RUN', 'ATTACK', 'ATTACK_2', 'HIT', 'CAST', 'CHANNEL', 'STUN', 'DEATH', 'RESPAWN', 'VICTORY'];
export const CLIP_KEY: Record<AnimState, ClipKey> = {
  IDLE: 'idle', WALK: 'walk', RUN: 'run', ATTACK: 'attack', ATTACK_2: 'attack2', HIT: 'hit', CAST: 'cast',
  CHANNEL: 'channel', STUN: 'stun', DEATH: 'death', RESPAWN: 'respawn', VICTORY: 'victory',
};
export const CLIP_KEYS = Object.values(CLIP_KEY) as ClipKey[];
/** Height of the hip joint above the feet in rig space. */
export const HIP_Y = 1;

/* ------------------------------------------------------------------ state machine (pure, no three.js) */

export interface AnimInput {
  dead?: boolean;
  /** Match lost: heroes collapse (same look as a death, but nothing respawns). */
  defeat?: boolean;
  victory?: boolean;
  stunned?: boolean;
  channeling?: boolean;
  /** Measured velocity and the velocity that counts as "full speed" (same units). */
  speed?: number;
  maxSpeed?: number;
  /** Set on the frame an attack starts: 1 = ATTACK, 2 = ATTACK_2. */
  attack?: 0 | 1 | 2;
  cast?: boolean;
  hit?: boolean;
}

const ONE_SHOT = new Set<AnimState>(['HIT', 'ATTACK', 'ATTACK_2', 'CAST', 'RESPAWN']);
const LOCO = new Set<AnimState>(['IDLE', 'WALK', 'RUN']);
const PRIORITY: Record<AnimState, number> = { IDLE: 0, WALK: 0, RUN: 0, CHANNEL: 2, HIT: 3, ATTACK: 4, ATTACK_2: 4, CAST: 5, RESPAWN: 6, STUN: 7, VICTORY: 9, DEATH: 10 };
/** A one-shot hands control back to locomotion after this fraction of its clip; the tail is covered by the cross-fade. */
const RELEASE = .85;
const HIT_COOLDOWN = .55;
const LOCO_HOLD = .12;
export const isOneShot = (s: AnimState): boolean => ONE_SHOT.has(s);
export const isLoco = (s: AnimState): boolean => LOCO.has(s);

export class AnimationStateMachine {
  state: AnimState = 'IDLE';
  prev: AnimState = 'IDLE';
  /** Seconds spent in the current state. */
  time = 0;
  /** True when the last step() entered a state (including re-entering the same one-shot). */
  changed = false;
  /** Playback speed the current state wants (walk / run follow the measured velocity). */
  timeScale = 1;
  /** speed / maxSpeed of the last step. */
  ratio = 0;
  private loco: AnimState = 'IDLE';
  private hitCd = 0;
  private locoHold = 0;
  private forced = false;
  private forceHold = Infinity;

  constructor(private durations: Partial<Record<AnimState, number>> = {}) {}

  setDurations(d: Partial<Record<AnimState, number>>): void { this.durations = d; }
  duration(s: AnimState): number { return this.durations[s] ?? .5; }
  /** True while a one-shot (attack, cast, hit, respawn) still owns the body. */
  get busy(): boolean { return ONE_SHOT.has(this.state) && this.time < this.duration(this.state) * RELEASE; }

  private enter(next: AnimState): void {
    this.prev = this.state; this.state = next; this.time = 0; this.changed = true;
    if (LOCO.has(next)) this.loco = next;
  }

  /** Manual control (hero-select preview, tests): jump to a state and stay there until the one-shot ends or `hold` runs out. */
  force(next: AnimState, hold?: number): void {
    this.enter(next);
    this.forced = true;
    this.forceHold = hold ?? (ONE_SHOT.has(next) ? this.duration(next) * RELEASE : Infinity);
    this.ratio = next === 'RUN' ? .95 : next === 'WALK' ? .42 : 0;
    this.timeScale = 1;
  }
  release(): void { this.forced = false; }

  step(input?: AnimInput, dt = 0): AnimState {
    this.changed = false;
    this.time += dt;
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.locoHold = Math.max(0, this.locoHold - dt);
    if (!input) {
      if (this.forced && this.time >= this.forceHold && this.state !== 'DEATH') { this.forced = false; this.enter('IDLE'); this.timeScale = 1; }
      return this.state;
    }
    this.forced = false;
    const inp = input, s = this.state;

    if (inp.dead || inp.defeat) { if (s !== 'DEATH') this.enter('DEATH'); this.timeScale = 1; return this.state; }
    if (s === 'DEATH') { this.enter('RESPAWN'); this.timeScale = 1; return this.state; }
    if (inp.victory) { if (s !== 'VICTORY') this.enter('VICTORY'); this.timeScale = 1; return this.state; }
    if (inp.stunned) { if (s !== 'STUN') this.enter('STUN'); this.timeScale = 1; return this.state; }

    const busy = this.busy, pri = busy ? PRIORITY[this.state] : 0;
    if (this.state === 'RESPAWN' && busy) { this.timeScale = 1; return this.state; }
    if (inp.cast && PRIORITY.CAST >= pri) this.enter('CAST');
    else if (inp.attack && PRIORITY.ATTACK >= pri) this.enter(inp.attack === 2 ? 'ATTACK_2' : 'ATTACK');
    else if (inp.hit && !busy && this.hitCd <= 0 && !ONE_SHOT.has(this.state)) { this.enter('HIT'); this.hitCd = HIT_COOLDOWN; }
    if (this.busy) { this.timeScale = 1; return this.state; }

    // Locomotion with hysteresis: idle <-> walk <-> run follow speed / maxSpeed.
    const ratio = inp.maxSpeed > 0 ? Math.max(0, (inp.speed || 0) / inp.maxSpeed) : 0;
    this.ratio = ratio;
    let want: AnimState = this.loco;
    if (this.loco === 'IDLE') want = ratio > .72 ? 'RUN' : ratio > .1 ? 'WALK' : 'IDLE';
    else if (this.loco === 'WALK') want = ratio > .72 ? 'RUN' : ratio < .05 ? 'IDLE' : 'WALK';
    else want = ratio < .05 ? 'IDLE' : ratio < .58 ? 'WALK' : 'RUN';
    if (want === 'IDLE' && inp.channeling) want = 'CHANNEL' as AnimState;
    const cur = this.state;
    if (cur !== want) {
      const free = LOCO.has(cur) ? this.locoHold <= 0 : true;
      if (free) { this.enter(want); this.locoHold = LOCO_HOLD; }
    }
    this.timeScale = this.state === 'WALK' ? clamp(ratio / .42, .6, 1.5) : this.state === 'RUN' ? clamp(ratio / .95, .75, 1.6) : 1;
    return this.state;
  }
}

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

/* ------------------------------------------------------------------ procedural clip authoring */

type V3 = [number, number, number];
export interface Pose {
  /** Hips offset from the rest position. */
  p?: V3;
  hips?: V3; spine?: V3; head?: V3;
  armL?: V3; foreL?: V3; armR?: V3; foreR?: V3;
  legL?: V3; shinL?: V3; legR?: V3; shinR?: V3;
}
const ROT = ['hips', 'spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'] as const;
type RotBone = typeof ROT[number];
type Full = Record<RotBone, V3> & { p: V3 };
type Ease = 'lin' | 'in' | 'out' | 'smooth';
type Key = [number, Pose, Ease?];

const EASE: Record<Ease, (t: number) => number> = { lin: t => t, in: t => t * t, out: t => 1 - (1 - t) * (1 - t), smooth: t => t * t * (3 - 2 * t) };
const Z3: V3 = [0, 0, 0];
const fill = (base: Pose, pose: Pose = {}): Full => {
  const o: any = { p: pose.p || base.p || Z3 };
  for (const b of ROT) o[b] = pose[b] || base[b] || Z3;
  return o;
};
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lerpFull = (a: Full, b: Full, t: number): Full => {
  const o: any = { p: lerp3(a.p, b.p, t) };
  for (const k of ROT) o[k] = lerp3(a[k], b[k], t);
  return o;
};
const MIRROR_NAME: Record<string, string> = { armL: 'armR', armR: 'armL', foreL: 'foreR', foreR: 'foreL', legL: 'legR', legR: 'legL', shinL: 'shinR', shinR: 'shinL' };
/** Left/right mirror of a full pose (swap L and R bones, flip yaw and roll). */
const mirrorFull = (f: Full): Full => {
  const o: any = { p: [-f.p[0], f.p[1], f.p[2]] };
  for (const k of ROT) { const v = f[k]; o[MIRROR_NAME[k] || k] = [v[0], -v[1], -v[2]]; }
  return o;
};

const E = new THREE.Euler(), Q = new THREE.Quaternion();

/** Samples `at(t)` (and every key time) and turns the poses into per-bone quaternion tracks plus a hips position track. */
function buildClip(name: string, duration: number, at: (t: number) => Full, extraTimes: number[] = [], fps = 30): THREE.AnimationClip {
  const ts = new Map<number, number>();
  const add = (t: number) => { t = clamp(t, 0, duration); ts.set(Math.round(t * 1e4), t); };
  for (let i = 0; i / fps < duration; i++) add(i / fps);
  add(duration); extraTimes.forEach(add);
  const times = [...ts.values()].sort((a, b) => a - b), poses = times.map(at);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const b of ROT) {
    const v: number[] = [];
    for (const f of poses) { const e = f[b]; Q.setFromEuler(E.set(e[0], e[1], e[2], 'XYZ')); v.push(Q.x, Q.y, Q.z, Q.w); }
    tracks.push(new THREE.QuaternionKeyframeTrack(b + '.quaternion', times, v));
  }
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, poses.flatMap(f => [f.p[0], HIP_Y + f.p[1], f.p[2]])));
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Piecewise pose keyframes; `ease` on a key shapes the segment that ends at that key. */
function keyed(keys: Key[], base: Pose): (t: number) => Full {
  const fulls = keys.map(k => fill(base, k[1]));
  return t => {
    if (t <= keys[0][0]) return fulls[0];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const a = keys[i - 1][0], b = keys[i][0], u = b > a ? (t - a) / (b - a) : 1;
        return lerpFull(fulls[i - 1], fulls[i], EASE[keys[i][2] || 'smooth'](u));
      }
    }
    return fulls[fulls.length - 1];
  };
}

/** Clip metadata that is not part of three's AnimationClip: when the weapon is swinging (for trails). */
const SWING = new WeakMap<THREE.AnimationClip, [number, number]>();
export const clipSwing = (c: THREE.AnimationClip): [number, number] | undefined => SWING.get(c);

/** Legs bent for a crouch of 0..1, hips lowered so the feet stay on the ground. */
const stance = (c = 0, spread = .05): Pose => {
  const th = .5 * c, sh = .9 * c, drop = .92 - .46 * Math.cos(th) - .46 * Math.cos(sh - th);
  return { p: [0, -drop, 0], legL: [-th, 0, spread], shinL: [sh, 0, 0], legR: [-th, 0, -spread], shinR: [sh, 0, 0] };
};

interface StyleSpec {
  base: Pose;
  /** Gait arm swing multipliers [L, R]: a hand that holds a weapon swings less. */
  swing: [number, number];
  /** Extra forward lean while running. */
  lean: number;
  /** Gait stride multiplier (default 1): robes and skirts hide long strides, so they get a shorter one. */
  stride?: number;
  attack: Key[]; attack2: Key[]; cast: Key[]; victory: Key[];
  /** Trail windows (seconds into the clip). A clip without a window never shows a weapon trail. */
  win: { attack?: [number, number]; attack2?: [number, number]; cast?: [number, number] };
}

const BASE: Pose = { p: [0, 0, 0], hips: Z3, spine: [.04, 0, 0], head: Z3, armL: [.06, 0, .12], foreL: [-.3, 0, 0], armR: [.06, 0, -.12], foreR: [-.3, 0, 0], ...stance(0) };
const mk = (o: Pose): Pose => ({ ...BASE, ...o });

/** Both arms overhead, hopping: used by every style unless it overrides it. */
const cheer = (b: Pose): Key[] => [
  [0, { ...b, armR: [-2.9, 0, -.3], foreR: [-.35, 0, 0], armL: [-2.3, 0, .45], foreL: [-.5, 0, 0], head: [-.25, 0, 0], spine: [-.12, 0, 0] }],
  [.35, { ...b, p: [0, .1, 0], armR: [-2.5, 0, -.25], foreR: [-.2, 0, 0], armL: [-2.9, 0, .3], foreL: [-.3, 0, 0], head: [-.3, .15, 0], spine: [-.18, 0, 0] }, 'out'],
  [.7, { ...b, armR: [-2.9, 0, -.3], foreR: [-.35, 0, 0], armL: [-2.3, 0, .45], foreL: [-.5, 0, 0], head: [-.25, 0, 0], spine: [-.12, 0, 0] }, 'in'],
  [1.05, { ...b, p: [0, .1, 0], armR: [-2.5, 0, -.25], foreR: [-.2, 0, 0], armL: [-2.9, 0, .3], foreL: [-.3, 0, 0], head: [-.3, -.15, 0], spine: [-.18, 0, 0] }, 'out'],
  [1.4, { ...b, armR: [-2.9, 0, -.3], foreR: [-.35, 0, 0], armL: [-2.3, 0, .45], foreL: [-.5, 0, 0], head: [-.25, 0, 0], spine: [-.12, 0, 0] }, 'in'],
];

function makeStyle(style: ClipStyle): StyleSpec {
  switch (style) {
    case 'blade': {
      const base = mk({ ...stance(.1, .07), spine: [.05, .1, 0], head: [0, -.1, 0], armR: [-.35, 0, -.2], foreR: [-.8, 0, 0], armL: [-.25, 0, .25], foreL: [-.95, 0, 0] });
      const wind = { spine: [-.05, -.6, 0], head: [0, .55, 0], armR: [-2.7, 0, -.2], foreR: [-.7, 0, 0], armL: [-.6, 0, .55], foreL: [-1, 0, 0], p: [0, -.03, -.05], legL: [-.3, 0, .1], shinL: [.3, 0, 0], legR: [.4, 0, -.1], shinR: [.35, 0, 0] } as Pose;
      const hit = { spine: [.26, .55, 0], head: [.1, -.45, 0], armR: [-.4, 0, .15], foreR: [-.2, 0, 0], armL: [-.2, 0, .75], foreL: [-.6, 0, 0], p: [0, -.12, .18], legL: [-.75, 0, .1], shinL: [.7, 0, 0], legR: [.65, 0, -.1], shinR: [.15, 0, 0] } as Pose;
      return {
        base, swing: [.35, .9], lean: .04,
        attack: [[0, base], [.1, wind, 'out'], [.22, hit, 'in'], [.34, { ...hit, spine: [.2, .7, 0], armR: [.1, 0, .4], foreR: [-.15, 0, 0] }, 'out'], [.55, base]],
        // Shield bash: the shield arm drives forward while the sword arm stays ready.
        attack2: [[0, base], [.1, { spine: [0, .35, 0], armL: [.3, 0, .35], foreL: [-1.8, 0, 0], armR: [-.6, 0, -.4], foreR: [-1.1, 0, 0], p: [0, -.05, -.04] }, 'out'],
          [.22, { spine: [.2, -.4, 0], armL: [-1.4, 0, .1], foreL: [-.35, 0, 0], armR: [-.6, 0, -.4], foreR: [-1.1, 0, 0], p: [0, -.1, .2], legL: [-.7, 0, .1], shinL: [.6, 0, 0], legR: [.55, 0, -.1], shinR: [.2, 0, 0] }, 'in'], [.34, { spine: [.2, -.45, 0], armL: [-1.5, 0, .1], foreL: [-.3, 0, 0], p: [0, -.1, .2] }, 'out'], [.55, base]],
        cast: [[0, base], [.12, { armR: [-2.6, 0, -.35], foreR: [-.5, 0, 0], armL: [-1.7, 0, .45], foreL: [-.7, 0, 0], spine: [-.2, 0, 0], head: [-.2, 0, 0], p: [0, -.04, 0] }, 'out'],
          [.25, { armR: [-2.9, 0, -.2], foreR: [-.3, 0, 0], armL: [-1.9, 0, .35], foreL: [-.5, 0, 0], spine: [-.3, 0, 0], head: [-.25, 0, 0], p: [0, .08, 0] }, 'in'], [.55, { armR: [-2.7, 0, -.25], foreR: [-.3, 0, 0], armL: [-1.8, 0, .4], foreL: [-.5, 0, 0], spine: [-.25, 0, 0], head: [-.2, 0, 0] }], [.8, base]],
        victory: cheer(base),
        win: { attack: [.09, .36], attack2: [.09, .3], cast: [.1, .55] },
      };
    }
    case 'smash': {
      const base = mk({ ...stance(.12, .16), spine: [.1, 0, 0], head: [-.05, 0, 0], armR: [-.3, 0, -.28], foreR: [-.75, 0, 0], armL: [.1, 0, .32], foreL: [-.45, 0, 0] });
      const up = { spine: [-.35, -.25, 0], head: [.2, .2, 0], armR: [-2.95, 0, -.15], foreR: [-.45, 0, 0], armL: [-.5, 0, .5], foreL: [-.9, 0, 0], p: [0, -.04, -.08] } as Pose;
      const slam = { spine: [.6, .2, 0], head: [.25, 0, 0], armR: [-.55, 0, -.05], foreR: [-.1, 0, 0], armL: [-.4, 0, .5], foreL: [-.7, 0, 0], p: [0, -.2, .2], legL: [-.7, 0, .22], shinL: [.7, 0, 0], legR: [-.5, 0, -.22], shinR: [.5, 0, 0] } as Pose;
      return {
        base, swing: [.8, .35], lean: .12,
        attack: [[0, base], [.11, up, 'out'], [.22, slam, 'in'], [.36, { ...slam, spine: [.66, .2, 0], p: [0, -.22, .2] }], [.7, base]],
        // Left-hand lightning punch.
        attack2: [[0, base], [.09, { spine: [0, .55, 0], head: [0, -.4, 0], armL: [.55, 0, .35], foreL: [-1.7, 0, 0], armR: [-.4, 0, -.3], foreR: [-.9, 0, 0], p: [0, -.06, -.06] }, 'out'],
          [.2, { spine: [.2, -.6, 0], head: [0, .4, 0], armL: [-1.55, 0, -.05], foreL: [-.1, 0, 0], armR: [-.4, 0, -.3], foreR: [-.9, 0, 0], p: [0, -.12, .24], legL: [-.8, 0, .2], shinL: [.7, 0, 0], legR: [.6, 0, -.2], shinR: [.2, 0, 0] }, 'in'], [.3, { spine: [.2, -.65, 0], armL: [-1.6, 0, -.05], foreL: [-.1, 0, 0], p: [0, -.12, .24] }, 'out'], [.55, base]],
        // Ground pound: both fists up, then slam.
        cast: [[0, base], [.14, { spine: [-.4, 0, 0], head: [.25, 0, 0], armR: [-2.7, 0, -.35], foreR: [-.4, 0, 0], armL: [-2.7, 0, .35], foreL: [-.4, 0, 0], p: [0, .1, -.05] }, 'out'],
          [.25, { spine: [.7, 0, 0], head: [.3, 0, 0], armR: [-.7, 0, -.3], foreR: [-.2, 0, 0], armL: [-.7, 0, .3], foreL: [-.2, 0, 0], p: [0, -.28, .12], legL: [-.8, 0, .3], shinL: [.8, 0, 0], legR: [-.8, 0, -.3], shinR: [.8, 0, 0] }, 'in'], [.55, { spine: [.6, 0, 0], armR: [-.7, 0, -.3], armL: [-.7, 0, .3], p: [0, -.26, .1], legL: [-.8, 0, .3], shinL: [.8, 0, 0], legR: [-.8, 0, -.3], shinR: [.8, 0, 0] }], [.8, base]],
        victory: cheer(base),
        win: { attack: [.1, .4], attack2: [.08, .3], cast: [.12, .4] },
      };
    }
    case 'dual': {
      // The forearms yaw outward so the daggers point forward and to the sides instead of crossing in front of the face.
      const base = mk({ ...stance(.42, .1), spine: [.24, 0, 0], head: [-.2, 0, 0], armR: [-.5, 0, -.38], foreR: [-1.1, -.5, 0], armL: [-.5, 0, .38], foreL: [-1.1, .5, 0] });
      const slashR: Key[] = [[0, base], [.07, { spine: [.2, -.55, 0], head: [-.2, .5, 0], armR: [-1.5, 0, -.95], foreR: [-.7, 0, 0], armL: [-.6, 0, .5], foreL: [-1.2, 0, 0], p: [0, -.12, -.06] }, 'out'],
        [.16, { spine: [.3, .6, 0], head: [-.2, -.5, 0], armR: [-1.15, 0, .65], foreR: [-.3, 0, 0], armL: [-.6, 0, .5], foreL: [-1.2, 0, 0], p: [0, -.15, .16], legL: [-.75, 0, .1], shinL: [.9, 0, 0], legR: [.35, 0, -.1], shinR: [.7, 0, 0] }, 'in'],
        [.26, { spine: [.3, .7, 0], head: [-.2, -.55, 0], armR: [-1, 0, .85], foreR: [-.3, 0, 0], p: [0, -.15, .16] }, 'out'], [.42, base]];
      const full = (k: Key[]): Key[] => k.map(([t, p, e]) => [t, { ...p }, e] as Key);
      const slashL: Key[] = slashR.map(([t, p, e]) => {
        const m = mirrorFull(fill(base, p)), o: Pose = {};
        for (const b of ROT) o[b] = m[b];
        o.p = m.p;
        return [t, o, e] as Key;
      });
      return {
        base, swing: [.85, .85], lean: .1,
        attack: full(slashR), attack2: slashL,
        // Throwing volley: both arms snap forward.
        cast: [[0, base], [.12, { spine: [.05, 0, 0], head: [-.1, 0, 0], armR: [-2.2, 0, -.75], foreR: [-.9, 0, 0], armL: [-2.2, 0, .75], foreL: [-.9, 0, 0], p: [0, -.12, -.08] }, 'out'],
          [.25, { spine: [.4, 0, 0], head: [-.2, 0, 0], armR: [-1.45, 0, -.3], foreR: [-.1, 0, 0], armL: [-1.45, 0, .3], foreL: [-.1, 0, 0], p: [0, -.18, .2], legL: [-.8, 0, .1], shinL: [.9, 0, 0], legR: [.3, 0, -.1], shinR: [.7, 0, 0] }, 'in'], [.5, { spine: [.35, 0, 0], armR: [-1.4, 0, -.3], armL: [-1.4, 0, .3], p: [0, -.16, .18] }], [.8, base]],
        victory: cheer(base),
        win: { attack: [.06, .28], attack2: [.06, .28], cast: [.1, .4] },
      };
    }
    case 'staff': {
      const base = mk({ ...stance(.06, .07), spine: [.04, .08, 0], armR: [-.5, 0, -.22], foreR: [-1, 0, 0], armL: [.12, 0, .25], foreL: [-.5, 0, 0] });
      return {
        base, swing: [1, .3], lean: .06,
        // Point the staff at the target.
        attack: [[0, base], [.1, { spine: [-.1, -.3, 0], head: [0, .3, 0], armR: [-.3, 0, -.55], foreR: [-1.7, 0, 0], armL: [-.2, 0, .55], foreL: [-.8, 0, 0], p: [0, -.03, -.04] }, 'out'],
          [.2, { spine: [.18, .1, 0], head: [-.05, -.1, 0], armR: [-1.55, 0, -.12], foreR: [-.2, 0, 0], armL: [-.5, 0, .65], foreL: [-.6, 0, 0], p: [0, -.05, .12] }, 'in'], [.32, { spine: [.18, .1, 0], armR: [-1.6, 0, -.1], foreR: [-.15, 0, 0], armL: [-.5, 0, .65], p: [0, -.05, .12] }], [.5, base]],
        // Overhead flick with the staff, off-hand sparks.
        attack2: [[0, base], [.1, { spine: [-.15, -.2, 0], armR: [-2.5, 0, -.25], foreR: [-.6, 0, 0], armL: [-1.4, 0, .45], foreL: [-.9, 0, 0], head: [-.15, 0, 0] }, 'out'],
          [.2, { spine: [.2, .15, 0], armR: [-1.05, 0, -.15], foreR: [-.3, 0, 0], armL: [-1.45, 0, .2], foreL: [-.3, 0, 0], p: [0, -.05, .1] }, 'in'], [.32, { spine: [.2, .15, 0], armR: [-1, 0, -.15], armL: [-1.45, 0, .2], p: [0, -.05, .1] }], [.5, base]],
        cast: [[0, base], [.12, { armR: [-2.25, 0, -.35], foreR: [-.45, 0, 0], armL: [-2.25, 0, .35], foreL: [-.45, 0, 0], spine: [-.25, 0, 0], head: [-.3, 0, 0], p: [0, .04, 0] }, 'out'],
          [.25, { armR: [-1.55, 0, -.15], foreR: [-.15, 0, 0], armL: [-1.55, 0, .15], foreL: [-.15, 0, 0], spine: [.25, 0, 0], head: [-.05, 0, 0], p: [0, -.05, .1] }, 'in'], [.5, { armR: [-1.6, 0, -.15], foreR: [-.15, 0, 0], armL: [-1.6, 0, .15], foreL: [-.15, 0, 0], spine: [.22, 0, 0], p: [0, -.04, .09] }], [.8, base]],
        victory: cheer(base),
        // A staff pokes and flicks: no ribbon for it, the orb and the spell effects carry the hit.
        win: { attack: [.12, .34], attack2: [.12, .34] },
      };
    }
    case 'robe': return { ...makeStyle('staff'), stride: .55 };
    default: { // beast: hunched, long arms, claw swipes
      const base = mk({ ...stance(.2, .12), spine: [.38, 0, 0], head: [-.32, 0, 0], armL: [-.15, 0, .4], foreL: [-.55, 0, 0], armR: [-.15, 0, -.4], foreR: [-.55, 0, 0] });
      const swipe = (s: number): Key[] => [[0, base],
        [.1, { spine: [.3, -.6 * s, 0], head: [-.3, .5 * s, 0], ...(s > 0 ? { armR: [-1.2, 0, -1.2], foreR: [-.3, 0, 0] } : { armL: [-1.2, 0, 1.2], foreL: [-.3, 0, 0] }), p: [0, -.04, -.06] } as Pose, 'out'],
        [.22, { spine: [.5, .6 * s, 0], head: [-.3, -.5 * s, 0], ...(s > 0 ? { armR: [-1.3, 0, .6], foreR: [-.1, 0, 0] } : { armL: [-1.3, 0, -.6], foreL: [-.1, 0, 0] }), p: [0, -.12, .2], legL: [-.7, 0, .12], shinL: [.8, 0, 0], legR: [.4, 0, -.12], shinR: [.5, 0, 0] } as Pose, 'in'],
        [.36, { spine: [.45, .65 * s, 0], ...(s > 0 ? { armR: [-1.2, 0, .8] } : { armL: [-1.2, 0, -.8] }), p: [0, -.1, .2] } as Pose, 'out'], [.55, base]];
      return {
        base, swing: [1, 1], lean: .15,
        attack: swipe(1), attack2: swipe(-1),
        cast: [[0, base], [.2, { spine: [-.1, 0, 0], head: [.45, 0, 0], armL: [-2.2, 0, .9], foreL: [-.4, 0, 0], armR: [-2.2, 0, -.9], foreR: [-.4, 0, 0], p: [0, .05, 0] }, 'out'], [.25, { spine: [-.15, 0, 0], head: [.5, 0, 0], armL: [-2.4, 0, 1], foreL: [-.3, 0, 0], armR: [-2.4, 0, -1], foreR: [-.3, 0, 0] }], [.6, { spine: [-.1, 0, 0], head: [.45, 0, 0], armL: [-2.3, 0, 1], armR: [-2.3, 0, -1] }], [.8, base]],
        victory: cheer(base),
        win: { attack: [.09, .38], attack2: [.09, .38], cast: [.2, .6] },
      };
    }
  }
}

const gaitFn = (st: StyleSpec, run: boolean) => {
  const k = st.stride ?? 1;
  const b = fill(st.base), A = (run ? .95 : .5) * k, KN = (run ? 1.5 : .85) * (.45 + .55 * k), AS = run ? .85 : .42, tw = run ? .2 : .1, bob = (run ? .075 : .04) * (.5 + .5 * k), lean = run ? .2 + st.lean : .04;
  return (ph: number): Full => {
    const o: any = { p: [0, b.p[1] + (run ? -bob : bob) * Math.cos(2 * ph), 0] };
    for (const [s, off, mult] of [['L', 0, st.swing[0]], ['R', Math.PI, st.swing[1]]] as [string, number, number][]) {
      const th = ph + off, leg = b['leg' + s] as V3, shin = b['shin' + s] as V3, arm = b['arm' + s] as V3, fore = b['fore' + s] as V3;
      o['leg' + s] = [leg[0] + A * Math.sin(th), 0, leg[2]];
      o['shin' + s] = [shin[0] + KN * Math.pow(Math.max(0, -Math.cos(th)), 1.2), 0, 0];
      o['arm' + s] = [arm[0] - AS * mult * Math.sin(th), 0, arm[2]];
      // The forearm keeps its yaw (daggers pointing outward) while the elbow bends with the stride.
      // Running tucks the elbows, but never past ~1.5 rad: a weapon hand already held high must not fold the blade over the head.
      o['fore' + s] = [run ? Math.min(fore[0] - .4, -1.25) - .25 * Math.max(0, -Math.sin(th)) * mult : fore[0] - .12 * mult * Math.max(0, -Math.sin(th)), fore[1], 0];
    }
    o.hips = [0, -tw * .5 * Math.sin(ph), .04 * Math.sin(ph)];
    o.spine = [b.spine[0] + lean, b.spine[1] + tw * Math.sin(ph), .03 * Math.sin(ph)];
    o.head = [b.head[0] - lean * .6, b.head[1] - tw * .6 * Math.sin(ph), -.03 * Math.sin(ph)];
    return o as Full;
  };
};

const idleFn = (st: StyleSpec) => {
  const b = fill(st.base);
  return (ph: number): Full => {
    const s = Math.sin(ph), c = Math.cos(ph), o: any = { ...b };
    o.p = [0, b.p[1] + .012 * s, 0];
    o.hips = [0, 0, .018 * s];
    o.spine = [b.spine[0] + .025 * s, b.spine[1] + .03 * c, 0];
    o.head = [b.head[0] + .03 * Math.sin(ph - .6), b.head[1] + .1 * c, 0];
    o.armL = [b.armL[0] + .035 * Math.sin(ph + .5), b.armL[1], b.armL[2] + .02 * s];
    o.armR = [b.armR[0] + .035 * Math.sin(ph + 1.2), b.armR[1], b.armR[2] - .02 * s];
    o.foreL = [b.foreL[0] - .03 * (1 - c) * .5, b.foreL[1], 0];
    o.foreR = [b.foreR[0] - .03 * (1 + s) * .5, b.foreR[1], 0];
    return o as Full;
  };
};

/** Clips that do not depend on the weapon style. */
function commonClips(st: StyleSpec): Pick<ClipSet, 'hit' | 'death' | 'respawn' | 'stun' | 'channel'> {
  const b = st.base, bf = fill(b), sp = bf.spine;
  const hit = buildClip('hit', .38, keyed([[0, b], [.07, { ...b, spine: [sp[0] - .55, bf.spine[1] * .5, 0], head: [bf.head[0] - .5, 0, 0], armL: [-.6, 0, .85], armR: [-.6, 0, -.85], foreL: [-.4, 0, 0], foreR: [-.4, 0, 0], p: [0, bf.p[1] - .05, -.14] }, 'out'], [.38, b, 'smooth']], b));
  const lying = { hips: [-1.55, 0, 0] as V3, p: [0, -.78, -.42] as V3, spine: [-.12, 0, 0] as V3, head: [-.25, .35, 0] as V3, armL: [-.3, 0, 1.15] as V3, foreL: [-.2, 0, 0] as V3, armR: [-.25, 0, -1.2] as V3, foreR: [-.25, 0, 0] as V3, legL: [.05, 0, .22] as V3, shinL: [.15, 0, 0] as V3, legR: [.0, 0, -.28] as V3, shinR: [.1, 0, 0] as V3 };
  const death = buildClip('death', 1.1, keyed([[0, b],
    [.12, { ...b, spine: [-.5, 0, 0], head: [-.5, 0, 0], p: [0, bf.p[1] - .04, -.12], armL: [-.7, 0, .9], armR: [-.7, 0, -.9], foreL: [-.3, 0, 0], foreR: [-.3, 0, 0], legL: [.15, 0, .15], legR: [-.1, 0, -.15] }, 'out'],
    [.5, { ...b, hips: [-.75, 0, 0], p: [0, -.45, -.3], spine: [-.2, 0, 0], head: [-.35, .3, 0], armL: [-.3, 0, 1], armR: [-.2, 0, -1.1], foreL: [-.3, 0, 0], foreR: [-.3, 0, 0], legL: [.6, 0, .2], shinL: [1.2, 0, 0], legR: [.2, 0, -.2], shinR: [.8, 0, 0] }, 'in'],
    [.82, { ...b, ...lying, hips: [-1.62, 0, 0], p: [0, -.8, -.45] }, 'in'],
    [1.1, { ...b, ...lying }, 'out']], b), [.12, .5, .82]);
  const respawn = buildClip('respawn', .9, keyed([[0, { ...b, ...lying }],
    [.35, { ...b, hips: [-.9, 0, 0], p: [0, -.55, -.3], spine: [.3, 0, 0], head: [-.1, 0, 0], armL: [-.8, 0, .6], armR: [-.8, 0, -.6], foreL: [-.5, 0, 0], foreR: [-.5, 0, 0], legL: [-.5, 0, .2], shinL: [1.1, 0, 0], legR: [-.5, 0, -.2], shinR: [1.1, 0, 0] }, 'out'],
    [.65, { ...b, p: [0, bf.p[1] - .1, 0], spine: [bf.spine[0] + .25, 0, 0], head: [-.15, 0, 0], armL: [-.3, 0, .4], armR: [-.3, 0, -.4], legL: [-.4, 0, .1], shinL: [.7, 0, 0], legR: [-.4, 0, -.1], shinR: [.7, 0, 0] }, 'out'],
    [.9, b, 'smooth']], b), [.35, .65]);
  const sf = (t: number): Full => {
    const ph = t / 1.2 * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
    return { ...bf, p: [0, bf.p[1] - .05, 0], hips: [0, 0, .09 * s], spine: [.28, .12 * c, .1 * s], head: [.45 + .08 * c, .25 * s, .08 * c], armL: [.3, 0, .35 + .1 * s], armR: [.3, 0, -.35 + .1 * s], foreL: [-.2, 0, 0], foreR: [-.2, 0, 0], legL: [bf.legL[0], 0, bf.legL[2]], shinL: [bf.shinL[0] + .15, 0, 0], legR: [bf.legR[0], 0, bf.legR[2]], shinR: [bf.shinR[0] + .15, 0, 0] } as Full;
  };
  const cf = (t: number): Full => {
    const ph = t / 1 * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
    return { ...bf, p: [0, bf.p[1] + .02 * s, 0], spine: [-.2 + .03 * s, 0, 0], head: [-.3, 0, 0], armL: [-2.1 + .06 * c, 0, .4], armR: [-2.1 - .06 * c, 0, -.4], foreL: [-.5 + .1 * s, 0, 0], foreR: [-.5 - .1 * s, 0, 0] } as Full;
  };
  return { hit, death, respawn, stun: buildClip('stun', 1.2, sf), channel: buildClip('channel', 1, cf) };
}

const CACHE = new Map<ClipStyle, ClipSet>();
/** Procedural clips for a weapon style (cached: every character of a style shares the same AnimationClip objects). */
export function proceduralClips(style: ClipStyle): ClipSet {
  let set = CACHE.get(style);
  if (set) return set;
  const st = makeStyle(style), TAU = Math.PI * 2;
  const mkc = (name: string, keys: Key[], dur: number, win?: [number, number]) => {
    const c = buildClip(name, dur, keyed(keys, st.base), keys.map(k => k[0]));
    if (win) SWING.set(c, win);
    return c;
  };
  const attack = mkc('attack', st.attack, st.attack[st.attack.length - 1][0], st.win.attack);
  const attack2 = mkc('attack2', st.attack2, st.attack2[st.attack2.length - 1][0], st.win.attack2);
  const cast = mkc('cast', st.cast, st.cast[st.cast.length - 1][0], st.win.cast);
  const victory = mkc('victory', st.victory, 1.4);
  const idleF = idleFn(st), walkF = gaitFn(st, false), runF = gaitFn(st, true);
  set = {
    idle: buildClip('idle', 2.4, t => idleF(t / 2.4 * TAU)),
    walk: buildClip('walk', .9, t => walkF(t / .9 * TAU), [], 24),
    run: buildClip('run', .56, t => runF(t / .56 * TAU), [], 30),
    attack, attack2, cast, victory,
    ...commonClips(st),
  };
  CACHE.set(style, set);
  return set;
}

/* ------------------------------------------------------------------ GLB clip mapping */

const PATTERNS: [ClipKey, RegExp][] = [
  ['respawn', /respawn|revive|spawn|get.?up|stand.?up|rise/i],
  ['stun', /stun|dizz|daze|knock/i],
  ['channel', /channel|charge|loop.?cast|cast.?loop/i],
  ['idle', /idle|stand|breath|rest|wait/i],
  ['walk', /walk/i],
  ['run', /run|sprint|jog/i],
  ['cast', /cast|spell|magic|skill|ability/i],
  ['hit', /hit|hurt|damage|react|flinch|impact/i],
  ['death', /death|die|dead|defeat/i],
  ['victory', /victory|win|cheer|celebrat|triumph/i],
];
const ATTACK = /attack|atk|slash|strike|punch|swing/i;
const FALLBACK: Partial<Record<ClipKey, ClipKey[]>> = {
  walk: ['run', 'idle'], run: ['walk', 'idle'], attack: ['cast', 'idle'], attack2: ['attack', 'cast', 'idle'], cast: ['attack', 'idle'],
  channel: ['cast', 'idle'], hit: ['idle'], stun: ['hit', 'idle'], respawn: ['idle'], victory: ['cast', 'idle'],
};
const FILL_ORDER: ClipKey[] = ['idle', 'walk', 'run', 'attack', 'attack2', 'cast', 'channel', 'hit', 'stun', 'death', 'respawn', 'victory'];
/** Root-only fallback so any model can "die" even when its GLB has no death clip. */
const deathRoot = new THREE.AnimationClip('death', 1, [
  new THREE.QuaternionKeyframeTrack('.quaternion', [0, .7, 1], [0, 0, 0, 1, ...Q.setFromEuler(E.set(-1.45, 0, 0)).toArray(), ...Q.setFromEuler(E.set(-1.57, 0, 0)).toArray()]),
  new THREE.VectorKeyframeTrack('.position', [0, .7, 1], [0, 0, 0, 0, .35, -.3, 0, .3, -.4]),
]);
const emptyIdle = new THREE.AnimationClip('idle', 1, []);

/** Maps arbitrary clip names (Idle, Walk_Cycle, Attack_01, Armature|Death ...) to the game's animation states. */
export function mapClips(clips: THREE.AnimationClip[]): ClipSet {
  const out: Partial<ClipSet> = {}, used = new Set<THREE.AnimationClip>();
  const atk = clips.filter(c => ATTACK.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (atk[0]) out.attack = atk[0];
  if (atk[1]) out.attack2 = atk[1];
  atk.forEach(c => used.add(c));
  for (const [key, re] of PATTERNS) {
    const c = clips.find(c => !used.has(c) && re.test(c.name));
    if (c) { out[key] = c; used.add(c); }
  }
  if (!out.idle) out.idle = emptyIdle;
  if (!out.death) out.death = deathRoot;
  for (const k of FILL_ORDER) if (!out[k]) { const f = (FALLBACK[k] || []).find(x => out[x]); out[k] = out[f || 'idle']; }
  return out as ClipSet;
}

/* ------------------------------------------------------------------ controller */

const GLB_SWING: Partial<Record<AnimState, [number, number]>> = { ATTACK: [.15, .7], ATTACK_2: [.15, .7], CAST: [.2, .75] };

function fadeFor(to: AnimState, from: AnimState): number {
  switch (to) {
    case 'ATTACK': case 'ATTACK_2': return .06;
    case 'CAST': return .08;
    case 'HIT': return .04;
    case 'DEATH': return .12;
    case 'STUN': return .08;
    case 'RESPAWN': return .1;
    case 'VICTORY': return .25;
    case 'CHANNEL': return .15;
    case 'IDLE': return isOneShot(from) ? .18 : .22;
    default: return isOneShot(from) ? .15 : .18; // WALK / RUN
  }
}

/**
 * One AnimationMixer per character, one action per state, and a state machine on top.
 *
 * Cross-fades are driven here instead of with AnimationAction.crossFadeTo: in three r128 a fade always starts from weight 0 or 1,
 * so interrupting a fade (attack -> hit -> idle within a few frames) pops. Each action keeps its own blend weight, the weights move
 * towards 0 / 1 at 1/fade per second and are normalised to sum to 1, so any interruption stays continuous.
 *
 * Game code calls `update(dt, input)` every frame. The hero-select preview and tests call `playX()` / `crossFadeTo()` and `update(dt)`.
 */
export class CharacterAnimationController {
  readonly mixer: THREE.AnimationMixer;
  readonly machine: AnimationStateMachine;
  readonly clips: ClipSet;
  readonly actions = {} as Record<AnimState, THREE.AnimationAction>;
  private unique: THREE.AnimationAction[] = [];
  private weights = new Map<THREE.AnimationAction, number>();
  private current: THREE.AnimationAction;
  private fade = .2;
  private ts = 1;
  private proc: boolean;

  constructor(root: THREE.Object3D, clips: Partial<ClipSet>, procedural = false) {
    this.proc = procedural;
    const idle = clips.idle || emptyIdle;
    this.clips = {} as ClipSet;
    for (const k of CLIP_KEYS) this.clips[k] = clips[k] || idle;
    this.mixer = new THREE.AnimationMixer(root);
    const durations: Partial<Record<AnimState, number>> = {};
    for (const s of ANIM_STATES) {
      const clip = this.clips[CLIP_KEY[s]], a = this.actions[s] = this.mixer.clipAction(clip);
      a.clampWhenFinished = true;
      durations[s] = clip.duration || .5;
      if (!this.unique.includes(a)) { this.unique.push(a); a.enabled = false; }
    }
    this.machine = new AnimationStateMachine(durations);
    this.current = this.actions.IDLE;
    this.applyLoop('IDLE', this.current);
    this.current.reset().play();
    this.weights.set(this.current, 1);
    this.current.setEffectiveWeight(1);
  }

  get state(): AnimState { return this.machine.state; }
  /** Playback time inside the current clip, in seconds. */
  get clipTime(): number { return this.current.time; }
  /** Fraction (0..1) of the current clip that has played. */
  get progress(): number { const d = this.current.getClip().duration; return d > 0 ? Math.min(1, this.current.time / d) : 0; }
  /** True while a weapon / hand is mid-swing (trail window of the current attack or cast clip). */
  get swinging(): boolean {
    const s = this.machine.state;
    if (s !== 'ATTACK' && s !== 'ATTACK_2' && s !== 'CAST') return false;
    const w = clipSwing(this.current.getClip()) || (this.proc ? undefined : this.glbWindow(s));
    return !!w && this.current.time >= w[0] && this.current.time <= w[1];
  }
  private glbWindow(s: AnimState): [number, number] | undefined {
    const w = GLB_SWING[s], d = this.current.getClip().duration;
    return w ? [w[0] * d, w[1] * d] : undefined;
  }

  private applyLoop(state: AnimState, a: THREE.AnimationAction): void {
    if (isOneShot(state) || state === 'DEATH') a.setLoop(THREE.LoopOnce, 1); else a.setLoop(THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = true;
  }

  /** Starts `state`: the new action fades in from its current weight while every other action fades out. */
  private start(state: AnimState, from: AnimState, fade?: number): void {
    const next = this.actions[state], prev = this.current;
    this.applyLoop(state, next);
    const sync = prev !== next && isLoco(state) && isLoco(from) && next.getClip().duration > 0;
    const phase = sync ? prev.time / (prev.getClip().duration || 1) : 0;
    next.reset(); next.play(); next.enabled = true;
    if (sync) next.time = phase * next.getClip().duration;
    if (!this.weights.has(next)) this.weights.set(next, 0);
    this.current = next;
    this.fade = Math.max(.001, fade ?? fadeFor(state, from));
    if (state === 'WALK' || state === 'RUN') this.ts = this.machine.timeScale; else this.ts = 1;
  }

  /** Cross-fades to `state` over `duration` seconds (interruption-safe). */
  crossFadeTo(state: AnimState, duration?: number): this {
    const from = this.machine.state;
    this.machine.force(state);
    this.machine.changed = false;
    this.start(state, from, duration);
    return this;
  }
  playIdle(fade?: number): this { return this.crossFadeTo('IDLE', fade); }
  playWalk(fade?: number): this { return this.crossFadeTo('WALK', fade); }
  playRun(fade?: number): this { return this.crossFadeTo('RUN', fade); }
  playAttack(alt = false, fade?: number): this { return this.crossFadeTo(alt ? 'ATTACK_2' : 'ATTACK', fade); }
  playCast(fade?: number): this { return this.crossFadeTo('CAST', fade); }
  playChannel(fade?: number): this { return this.crossFadeTo('CHANNEL', fade); }
  playHit(fade?: number): this { return this.crossFadeTo('HIT', fade); }
  playStun(fade?: number): this { return this.crossFadeTo('STUN', fade); }
  playDeath(fade?: number): this { return this.crossFadeTo('DEATH', fade); }
  playRespawn(fade?: number): this { return this.crossFadeTo('RESPAWN', fade); }
  playVictory(fade?: number): this { return this.crossFadeTo('VICTORY', fade); }

  /** Advances the state machine (when `input` is given), the blend weights and the mixer. */
  update(dt: number, input?: AnimInput): void {
    const m = this.machine, from = m.state;
    m.step(input, dt);
    if (m.changed) { m.changed = false; this.start(m.state, from); }
    this.ts += (m.timeScale - this.ts) * Math.min(1, dt * 8);
    this.current.timeScale = m.state === 'WALK' || m.state === 'RUN' ? this.ts : 1;
    this.blend(dt);
    this.mixer.update(dt);
  }

  private blend(dt: number): void {
    const step = dt / this.fade;
    let sum = 0;
    for (const a of this.unique) {
      const target = a === this.current ? 1 : 0, w0 = this.weights.get(a) || 0;
      const w = target > w0 ? Math.min(target, w0 + step) : Math.max(target, w0 - step);
      this.weights.set(a, w); sum += w;
    }
    for (const a of this.unique) {
      const w = sum > 0 ? this.weights.get(a) / sum : 0;
      a.enabled = a === this.current || w > .0005;
      a.setEffectiveWeight(a.enabled ? w : 0);
    }
  }

  /** Current normalised blend weight of the action for `state` (0 when it is not playing). */
  weight(state: AnimState): number { const a = this.actions[state]; return a.enabled ? a.getEffectiveWeight() : 0; }

  dispose(): void { this.mixer.stopAllAction(); }
}
