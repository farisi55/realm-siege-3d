/**
 * The maths of the MOBA camera, free of scene objects so it can be tested without a GPU.
 *
 * The camera stays an isometric RTS / MOBA camera: a fixed pitch, a focus point on the ground and a distance. What the rig adds is the
 * motion between the inputs and the picture: every value glides (critically damped), zoom and rotation are animated instead of
 * jumping, the focus keeps a soft margin to the edge of the map, the focus height follows the terrain smoothly, and impacts shake and
 * punch the picture without ever changing what the mouse picks (the rig keeps a second, un-shaken pose for that).
 */

export const ZOOM_MIN = 25, ZOOM_MAX = 110;
export const DEFAULT_YAW = -.785;
const TAU = Math.PI * 2;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
/** Wraps an angle to (-PI, PI]. */
export const wrapPi = (a: number): number => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const ease = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

/** Velocity memory of a damped value. */
export interface Vel { vel: number; }

/**
 * Critically damped smoothing towards `target` (the "SmoothDamp" of game programming gems 4): reaches the target in about four
 * `smoothTime`s without overshooting, and gives the same result whatever the frame time. `maxSpeed` caps how fast it may move.
 */
export function smoothDamp(current: number, target: number, s: Vel, smoothTime: number, dt: number, maxSpeed = Infinity): number {
  if (dt <= 0) return current;
  smoothTime = Math.max(1e-4, smoothTime);
  const omega = 2 / smoothTime, x = omega * dt, e = 1 / (1 + x + .48 * x * x + .235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(current - target, -maxChange, maxChange), goal = current - change;
  const tmp = (s.vel + omega * change) * dt;
  s.vel = (s.vel - omega * tmp) * e;
  let out = goal + (change + tmp) * e;
  if (target - current > 0 === out > target) { out = target; s.vel = 0; } // never overshoot
  return out;
}

/** `smoothDamp` for angles: takes the short way round. */
export function smoothDampAngle(current: number, target: number, s: Vel, smoothTime: number, dt: number): number {
  return smoothDamp(current, current + wrapPi(target - current), s, smoothTime, dt);
}

/** A damped spring around 0: `x` is the displacement, `v` its velocity. */
export interface Spring { x: number; v: number; }
/**
 * Advances a spring (angular frequency `omega`, damping ratio `zeta`, kept under 1: it rings) by its exact solution, so the result is
 * the same whatever the frame time and a long frame (a tab coming back to the front) can never make it unstable.
 */
export function stepSpring(s: Spring, omega: number, zeta: number, dt: number): void {
  if (dt <= 0) return;
  const z = Math.min(zeta, .999), a = z * omega, wd = omega * Math.sqrt(1 - z * z);
  const e = Math.exp(-a * dt), c = Math.cos(wd * dt), n = Math.sin(wd * dt);
  const A = s.x, B = (s.v + a * s.x) / wd;
  s.x = e * (A * c + B * n);
  s.v = e * ((B * wd - a * A) * c - (A * wd + a * B) * n);
}

/** Smooth pseudo-noise in about -1..1 (three sines of unrelated frequency): continuous, so a shake never pops. */
const noise = (t: number, seed: number): number =>
  Math.sin(t + seed * 12.9898) * .6 + Math.sin(t * 1.6 + seed * 78.233) * .3 + Math.sin(t * 2.2 + seed * 37.719) * .1;

/**
 * "Trauma" shake: impacts add trauma (0..1, adding up with diminishing returns), it drains steadily, and the picture moves by
 * trauma squared, so small hits are barely there and big ones are clearly felt. `rough` picks the character: 0 is a slow rumble,
 * 1 a sharp jitter.
 */
export class Trauma {
  trauma = 0; rough = .5; decay = 1.5;
  private t = 0;
  add(amount: number, rough = .5): void {
    const a = clamp(amount, 0, 1);
    if (a <= 0) return;
    this.rough = (this.rough * this.trauma + clamp(rough, 0, 1) * a) / (this.trauma + a);
    this.trauma = 1 - (1 - this.trauma) * (1 - a);
  }
  update(dt: number): void {
    if (dt <= 0) return;
    this.t += dt * TAU * (4 + 9 * this.rough);
    this.trauma = Math.max(0, this.trauma - dt * this.decay);
  }
  /** Current displacement in -1..1 (already scaled by trauma squared) for x, y and roll. */
  sample(out: { x: number; y: number; r: number }): void {
    const s = this.trauma * this.trauma;
    out.x = s ? noise(this.t, 1) * s : 0; out.y = s ? noise(this.t, 2) * s : 0; out.r = s ? noise(this.t, 3) * s : 0;
  }
  clear(): void { this.trauma = 0; }
}

/** How far from the map edge the focus may go (logic units): the closer the zoom, the nearer the edge, as less of the void shows. */
export const boundsMargin = (dist: number): number => clamp(dist * 3.2, 80, 360);

/**
 * How much of an impact's shake reaches the picture: 1 for impacts on screen, fading smoothly to 0 for ones far outside it, so a tower
 * falling across the map is a distant rumble, not a jolt. `dist` is the distance from the camera focus, `visible` the radius of the
 * ground on screen (both in world units).
 */
export const impactAttenuation = (dist: number, visible: number): number => 1 - ease((dist - visible * .45) / (visible * 1.35));

/** Smoothing times (seconds) of the rig. */
export const T = { follow: .16, yaw: .13, zoom: .14, height: .4, maxFollowSpeed: 4200 };
/** Peak shake: world units of translation and radians of roll at trauma 1 (at the default distance of 48). */
export const SHAKE = { amp: 1, roll: .012 };

export interface RigPose {
  /** What is rendered: camera position and look-at point, with shake, punch and push applied; `roll` in radians. */
  px: number; py: number; pz: number; lx: number; ly: number; lz: number; roll: number;
  /** The same without any of that: what the mouse picks with, so aiming never wobbles. */
  ax: number; ay: number; az: number; alx: number; aly: number; alz: number;
  /** Camera right / up vectors (world), for orienting sprites. */
  rx: number; rz: number; ux: number; uy: number; uz: number;
}

/** The values another module may write to `app.cam`; the rig adopts them when they differ from what it published last. */
export interface CamState { k: { x: number; y: number }; cy: number; cd: number; }

export class CamRig {
  /** Focus (logic units), the height it stands at (world units), yaw (radians) and distance (world units), all smoothed. */
  fx = 1600; fy = 1600; fh = 0; yaw = DEFAULT_YAW; dist = 48;
  /** Where the inputs want yaw and distance to go. */
  yawGoal = DEFAULT_YAW; distGoal = 48;
  readonly shake = new Trauma();
  /** Scales every shake / punch (accessibility: reduced motion). */
  motion = 1;
  readonly pose: RigPose = { px: 0, py: 0, pz: 0, lx: 0, ly: 0, lz: 0, roll: 0, ax: 0, ay: 0, az: 0, alx: 0, aly: 0, alz: 0, rx: 1, rz: 0, ux: 0, uy: 1, uz: 0 };
  private vx: Vel = { vel: 0 }; private vy: Vel = { vel: 0 }; private vh: Vel = { vel: 0 }; private vyaw: Vel = { vel: 0 }; private vd: Vel = { vel: 0 };
  private lift = 0;
  private punch: Spring = { x: 0, v: 0 }; private pushX: Spring = { x: 0, v: 0 }; private pushZ: Spring = { x: 0, v: 0 };
  private fin: { x: number; y: number; t: number } | null = null;
  private inited = false; private needH = true;
  private lk = { x: NaN, y: NaN }; private lyaw = NaN; private ld = NaN;
  private q = { x: 0, y: 0, r: 0 };

  /** `world` is the size of the map in logic units, `unit` the world units per logic unit (K). */
  constructor(readonly world: number, readonly unit: number) {}

  /** Adopts values another module wrote to `app.cam` since `publish` (a match start, an instant recenter): the rig snaps to them. */
  sync(c: CamState): void {
    const first = !this.inited;
    if (first || c.k.x !== this.lk.x || c.k.y !== this.lk.y) { this.fx = c.k.x; this.fy = c.k.y; this.vx.vel = this.vy.vel = 0; this.needH = true; }
    if (first || c.cy !== this.lyaw) { this.yaw = this.yawGoal = c.cy; this.vyaw.vel = 0; }
    if (first || c.cd !== this.ld) { this.dist = this.distGoal = clamp(c.cd, ZOOM_MIN, ZOOM_MAX); this.vd.vel = 0; }
  }
  /** Writes the smoothed values back to `app.cam` (the simulation reads `cy`, the minimap and culling read `k` and `cd`). */
  publish(c: CamState): void {
    c.k.x = this.lk.x = this.fx; c.k.y = this.lk.y = this.fy; c.cy = this.lyaw = this.yaw; c.cd = this.ld = this.dist;
  }

  // ---- inputs ----
  /** Mouse wheel: multiplicative, so every notch feels the same at any distance (a notch of 100 is about 9 %). */
  zoomBy(deltaY: number): void { if (!this.fin) this.distGoal = clamp(this.distGoal * Math.exp(deltaY * .0009), ZOOM_MIN, ZOOM_MAX); }
  setZoom(d: number): void { this.distGoal = clamp(d, ZOOM_MIN, ZOOM_MAX); }
  /** Free rotation (middle-button drag). */
  rotateBy(rad: number): void { this.yawGoal += rad; }
  /** One step of 45 degrees (the `[` and `]` keys): snaps to the eight isometric directions. */
  rotateStep(dir: number): void { const q = Math.PI / 4; this.yawGoal = Math.round(this.yawGoal / q) * q + dir * q; }
  resetYaw(): void { this.yawGoal = DEFAULT_YAW; }
  /** An impact at distance `att` (0..1, already attenuated by the caller) adds shake. */
  addShake(amount: number, rough = .5): void { this.shake.add(amount * this.motion, rough); }
  /** A punch: the camera pushes in a little and is shoved away from the blast (`dx`, `dz` the world direction from the blast to the focus). */
  addKick(amount: number, dx = 0, dz = 0): void {
    const a = clamp(amount, 0, 1) * this.motion, l = Math.hypot(dx, dz);
    this.punch.v += a * 1.2;
    if (l > 1e-3) { this.pushX.v += dx / l * a * 7; this.pushZ.v += dz / l * a * 7; }
  }
  /** The match is over: drift to the point (logic units) and move in a little. */
  finale(x: number, y: number): void { this.fin = { x, y, t: 0 }; }
  get finaleActive(): boolean { return !!this.fin; }
  /** Radius (world units) of the ground that is visible around the focus, roughly. */
  get visible(): number { return this.dist * 1.15; }
  /** Drops shake, punch and the finale (a new match). */
  reset(): void {
    this.shake.clear(); this.punch.x = this.punch.v = 0; this.pushX.x = this.pushX.v = 0; this.pushZ.x = this.pushZ.v = 0; this.lift = 0; this.fin = null;
    this.inited = false;
  }

  /**
   * One frame. (`gx`, `gy`) is where the camera wants to look (logic units: the hero plus the edge-scroll offset), `pitch` the fixed
   * angle above the ground, `ground` the render height under a logic point and `camGround` the terrain height used for clearance.
   */
  update(dt: number, gx: number, gy: number, pitch: number, ground: (x: number, y: number) => number, camGround: (x: number, y: number) => number): RigPose {
    this.inited = true;
    const K = this.unit;
    // the finale takes over the goal: drift to the point and draw a little closer
    let tx = gx, ty = gy, zg = this.distGoal;
    if (this.fin) {
      const f = this.fin; f.t += Math.max(0, dt);
      const w = ease(f.t / 1.4);
      tx += (f.x - gx) * w; ty += (f.y - gy) * w; zg += Math.min(0, 40 - zg) * w;
    }
    const m = boundsMargin(this.dist);
    tx = clamp(tx, m, this.world - m); ty = clamp(ty, m, this.world - m);
    // ground height under the focus: the focus and four points around it, so a hill does not lift the camera in one jolt
    const R = 90, hT = (ground(this.fx, this.fy) * 2 + ground(this.fx + R, this.fy) + ground(this.fx - R, this.fy) + ground(this.fx, this.fy + R) + ground(this.fx, this.fy - R)) / 6;
    if (this.needH) { this.fh = hT; this.vh.vel = 0; this.needH = false; }
    if (dt > 0) {
      this.fx = smoothDamp(this.fx, tx, this.vx, T.follow, dt, T.maxFollowSpeed); this.fy = smoothDamp(this.fy, ty, this.vy, T.follow, dt, T.maxFollowSpeed);
      this.fh = smoothDamp(this.fh, hT, this.vh, T.height, dt);
      this.yaw = smoothDampAngle(this.yaw, this.yawGoal, this.vyaw, T.yaw, dt);
      const w = wrapPi(this.yaw) - this.yaw; this.yaw += w; this.yawGoal += w; // keep both inside one turn
      this.dist = smoothDamp(this.dist, zg, this.vd, T.zoom, dt);
      this.shake.update(dt);
      stepSpring(this.punch, 16, .42, dt); stepSpring(this.pushX, 14, .5, dt); stepSpring(this.pushZ, 14, .5, dt);
      this.punch.x = clamp(this.punch.x, -.07, .07);
    }
    this.dist = clamp(this.dist, ZOOM_MIN - 1, ZOOM_MAX + 1);

    const s = Math.sin(this.yaw), c = Math.cos(this.yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), P = this.pose;
    const tx_ = this.fx * K, tz_ = this.fy * K, ty_ = this.fh, d = this.dist;
    // base camera: on a sphere around the focus, kept above the terrain with a soft lift instead of a hard clamp
    const ax = tx_ + s * cp * d, az = tz_ + c * cp * d, ay0 = ty_ + sp * d;
    const need = Math.max(0, camGround(ax / K, az / K) + 3 - ay0);
    if (dt > 0) this.lift += (need - this.lift) * (1 - Math.exp(-dt * (need > this.lift ? 14 : 2.5)));
    const ay = ay0 + this.lift;
    // camera basis
    P.rx = c; P.rz = -s; P.ux = -s * sp; P.uy = cp; P.uz = -c * sp;
    // rendered camera: punch pulls it towards the focus, push and shake move the whole picture
    const k1 = 1 - this.punch.x, amp = SHAKE.amp * (d / 48);
    this.shake.sample(this.q);
    const qx = this.q.x * amp, qy = this.q.y * amp;
    const ox = P.rx * qx + P.ux * qy + this.pushX.x, oy = P.uy * qy, oz = P.rz * qx + P.uz * qy + this.pushZ.x;
    P.px = tx_ + (ax - tx_) * k1 + ox; P.py = ty_ + (ay - ty_) * k1 + oy; P.pz = tz_ + (az - tz_) * k1 + oz;
    P.lx = tx_ + ox; P.ly = ty_ + oy; P.lz = tz_ + oz;
    P.roll = this.q.r * SHAKE.roll;
    P.ax = ax; P.ay = ay; P.az = az; P.alx = tx_; P.aly = ty_; P.alz = tz_;
    return P;
  }
}
