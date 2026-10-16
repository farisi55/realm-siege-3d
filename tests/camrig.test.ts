import { describe, it, expect } from 'vitest';
import {
  CamRig, DEFAULT_YAW, SHAKE, T, Trauma, ZOOM_MAX, ZOOM_MIN, boundsMargin, impactAttenuation, smoothDamp, smoothDampAngle, stepSpring, wrapPi,
} from '../src/render/camrig';

// The camera maths is plain numbers: no scene, no DOM, no GPU.

const W = 3200, K = 1 / 20, PITCH = .95, DT = 1 / 60;
const flat = () => 0;

/** A rig that has been started at (x, y) the way app.cam starts a match. */
function fresh(x = 1600, y = 1600) {
  const r = new CamRig(W, K), c = { k: { x, y }, cy: DEFAULT_YAW, cd: 48 };
  r.sync(c); r.update(0, x, y, PITCH, flat, flat);
  return { r, c };
}
/** `secs` of frames with the camera wanting to look at (gx, gy); returns the last pose. */
function run(r: CamRig, secs: number, gx: number, gy: number, dt = DT, ground: (x: number, y: number) => number = flat, camGround: (x: number, y: number) => number = flat) {
  let p = r.pose;
  for (let t = 0; t < secs - 1e-9; t += dt) p = r.update(dt, gx, gy, PITCH, ground, camGround);
  return p;
}
const shift = (p: { lx: number; ly: number; lz: number; alx: number; aly: number; alz: number }) => Math.hypot(p.lx - p.alx, p.ly - p.aly, p.lz - p.alz);

describe('smoothDamp', () => {
  const sim = (target: number, smoothTime: number, dt: number, secs: number, maxSpeed = Infinity, from = 0) => {
    const s = { vel: 0 }, xs: number[] = [];
    let x = from;
    for (let t = 0; t < secs - 1e-9; t += dt) { x = smoothDamp(x, target, s, smoothTime, dt, maxSpeed); xs.push(x); }
    return { x, xs };
  };

  it('approaches the target without ever overshooting, and settles in about four smoothing times', () => {
    const { xs, x } = sim(100, .16, DT, 1.5);
    for (let i = 1; i < xs.length; i++) { expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1]); expect(xs[i]).toBeLessThanOrEqual(100); }
    expect(100 - sim(100, .16, DT, 4 * .16).x).toBeLessThan(1); // within 1 %
    expect(100 - x).toBeLessThan(.01);
  });
  it('gives the same motion whatever the frame rate', () => {
    const at = (dt: number) => sim(100, .16, dt, .5).x;
    expect(Math.abs(at(1 / 30) - at(1 / 144))).toBeLessThan(.5); expect(Math.abs(at(1 / 60) - at(1 / 144))).toBeLessThan(.5);
  });
  it('does nothing for a zero or negative frame', () => {
    const s = { vel: 3 };
    expect(smoothDamp(5, 100, s, .16, 0)).toBe(5); expect(smoothDamp(5, 100, s, .16, -1)).toBe(5); expect(s.vel).toBe(3);
  });
  it('caps the speed it travels at', () => {
    const { x } = sim(1000, .16, DT, 2, 10);
    expect(x).toBeGreaterThan(14); expect(x).toBeLessThanOrEqual(20.5); // ~10 units per second once up to speed, never more
  });
  it('stops dead on the target instead of overshooting when it arrives with speed', () => {
    const s = { vel: 100 };
    expect(smoothDamp(.99, 1, s, .16, DT)).toBe(1); expect(s.vel).toBe(0);
  });
});

describe('angles', () => {
  it('smoothDampAngle takes the short way round', () => {
    const s = { vel: 0 };
    let a = 3.0, prev = a;
    for (let i = 0; i < 120; i++) { a = smoothDampAngle(a, -3.0, s, .13, DT); expect(a).toBeGreaterThanOrEqual(prev); prev = a; } // +.28 rad through PI, not -6 rad the long way
    expect(a).toBeGreaterThan(Math.PI);
    expect(Math.cos(a)).toBeCloseTo(Math.cos(-3), 3); expect(Math.sin(a)).toBeCloseTo(Math.sin(-3), 3);
  });
  it('wrapPi keeps angles within one turn and the same direction', () => {
    for (let a = -50; a <= 50; a += .37) {
      const w = wrapPi(a);
      expect(Math.abs(w)).toBeLessThanOrEqual(Math.PI + 1e-9); expect(Math.cos(w)).toBeCloseTo(Math.cos(a), 9); expect(Math.sin(w)).toBeCloseTo(Math.sin(a), 9);
    }
  });
});

describe('stepSpring', () => {
  it('rings down to rest', () => {
    const s = { x: 1, v: 0 };
    for (let i = 0; i < 120; i++) stepSpring(s, 16, .42, DT);
    expect(Math.abs(s.x)).toBeLessThan(1e-3);
  });
  it('is stable for any frame length: a long frame (a tab coming back to the front) only lets it ring down', () => {
    for (const dt of [.05, .5, 1, 10, 600]) {
      const s = { x: 1, v: 5 };
      stepSpring(s, 16, .42, dt);
      expect(Number.isFinite(s.x) && Number.isFinite(s.v), `dt ${dt}`).toBe(true); expect(Math.abs(s.x), `dt ${dt}`).toBeLessThan(1);
    }
  });
  it('is exact: the same motion at any frame rate, equal to the closed-form solution', () => {
    const at = (steps: number, secs: number) => { const s = { x: 1, v: 0 }; for (let i = 0; i < steps; i++) stepSpring(s, 16, .42, secs / steps); return s; };
    const a = at(9, .3), b = at(43, .3), c = at(300, .3);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1e-9); expect(Math.abs(a.v - b.v)).toBeLessThan(1e-9); expect(Math.abs(a.x - c.x)).toBeLessThan(1e-9);
    const z = .42, w = 16, wd = w * Math.sqrt(1 - z * z), t = .5, s = at(30, t);
    expect(s.x).toBeCloseTo(Math.exp(-z * w * t) * (Math.cos(wd * t) + z * w / wd * Math.sin(wd * t)), 9); // x(t) = e^(-zeta omega t) (cos wd t + zeta omega / wd sin wd t)
  });
  it('rings: overshoots to the other side on the way back, as a punch should', () => {
    const s = { x: 1, v: 0 };
    let min = 1;
    for (let i = 0; i < 60; i++) { stepSpring(s, 16, .42, DT); min = Math.min(min, s.x); }
    expect(min).toBeLessThan(0); expect(min).toBeGreaterThan(-.5);
  });
});

describe('Trauma shake', () => {
  const o = { x: 0, y: 0, r: 0 };

  it('adds up with diminishing returns and never exceeds 1', () => {
    const t = new Trauma();
    t.add(.5); expect(t.trauma).toBeCloseTo(.5, 9);
    t.add(.5); expect(t.trauma).toBeCloseTo(.75, 9);
    t.add(1); expect(t.trauma).toBe(1);
    t.add(5); expect(t.trauma).toBe(1);
    t.clear(); t.add(-1); t.add(0); expect(t.trauma).toBe(0);
  });
  it('drains steadily: 0.9 is gone in about 0.6 s', () => {
    const t = new Trauma();
    t.add(.9); t.update(.3); expect(t.trauma).toBeCloseTo(.45, 6);
    t.update(.3); expect(t.trauma).toBeCloseTo(0, 9);
    t.update(1); expect(t.trauma).toBe(0);
  });
  it('moves the picture by trauma squared: barely at low trauma, within the amplitude at high', () => {
    const t = new Trauma(); t.decay = 0;
    const peak = (trauma: number) => {
      t.clear(); t.add(trauma);
      let m = 0;
      for (let i = 0; i < 600; i++) { t.update(DT); t.sample(o); m = Math.max(m, Math.abs(o.x), Math.abs(o.y), Math.abs(o.r)); }
      return m;
    };
    const lo = peak(.2), mid = peak(.5), hi = peak(1);
    expect(lo).toBeLessThanOrEqual(.04 + 1e-9); expect(mid).toBeLessThanOrEqual(.25 + 1e-9); expect(hi).toBeLessThanOrEqual(1 + 1e-9);
    expect(lo).toBeLessThan(mid); expect(mid).toBeLessThan(hi); expect(hi).toBeGreaterThan(.5);
    t.clear(); t.sample(o);
    expect(o).toEqual({ x: 0, y: 0, r: 0 });
  });
  it('is rougher (faster) when asked to be, and mixes roughness by weight', () => {
    const crossings = (rough: number) => {
      const t = new Trauma(); t.decay = 0; t.add(1, rough);
      let n = 0, prev = 0;
      for (let i = 0; i < 120; i++) { t.update(DT); t.sample(o); if (prev * o.x < 0) n++; prev = o.x; }
      return n;
    };
    expect(crossings(1)).toBeGreaterThan(crossings(0) * 1.5);
    const t = new Trauma(); t.add(.5, 0); t.add(.5, 1);
    expect(t.rough).toBeCloseTo(.5, 9);
  });
});

describe('limits', () => {
  it('boundsMargin lets the camera go nearer the map edge the closer it is zoomed, within fixed limits', () => {
    expect(boundsMargin(ZOOM_MIN)).toBe(80); expect(boundsMargin(48)).toBeCloseTo(153.6, 6); expect(boundsMargin(ZOOM_MAX)).toBeCloseTo(352, 6); expect(boundsMargin(500)).toBe(360);
    let prev = 0;
    for (let d = ZOOM_MIN; d <= ZOOM_MAX; d += 5) { const m = boundsMargin(d); expect(m).toBeGreaterThanOrEqual(prev); prev = m; }
  });
  it('impactAttenuation is 1 on screen, 0 far outside it, and falls smoothly in between', () => {
    const R = 55;
    expect(impactAttenuation(0, R)).toBe(1); expect(impactAttenuation(R * .45, R)).toBe(1);
    expect(impactAttenuation(R * 1.8, R)).toBe(0); expect(impactAttenuation(R * 10, R)).toBe(0);
    expect(impactAttenuation(R * 1.125, R)).toBeCloseTo(.5, 6);
    let prev = 1;
    for (let d = 0; d <= R * 2; d += 1) { const a = impactAttenuation(d, R); expect(a).toBeLessThanOrEqual(prev + 1e-12); expect(a).toBeGreaterThanOrEqual(0); prev = a; }
  });
});

describe('CamRig follow', () => {
  it('glides to a new target: a gentle start, within 1 % after a second', () => {
    const { r } = fresh(1000, 1000);
    r.update(DT, 1600, 1000, PITCH, flat, flat);
    expect(r.fx - 1000).toBeGreaterThan(0); expect(r.fx - 1000).toBeLessThan(15); // under 2.5 % of the distance on the first frame
    run(r, 1, 1600, 1000);
    expect(Math.abs(r.fx - 1600) / 600).toBeLessThan(.01); expect(r.fy).toBe(1000);
  });
  it('never travels faster than its speed cap, however far the target jumps', () => {
    const { r } = fresh(300, 300);
    run(r, .5, 2900, 300);
    expect(r.fx - 300).toBeLessThan(T.maxFollowSpeed * .5); expect(r.fx - 300).toBeGreaterThan(300);
  });
  it('keeps the focus inside the map margin, which shrinks as the camera zooms in', () => {
    const { r } = fresh();
    run(r, 5, -500, 99999);
    expect(r.fx).toBeCloseTo(boundsMargin(48), 0); expect(r.fy).toBeCloseTo(W - boundsMargin(48), 0);
    r.setZoom(ZOOM_MIN); run(r, 3, -500, 99999);
    expect(r.fx).toBeCloseTo(80, 0); expect(r.fy).toBeCloseTo(W - 80, 0);
    r.setZoom(ZOOM_MAX); run(r, 3, 1600, 1600); run(r, 3, -500, 99999);
    expect(r.fx).toBeCloseTo(352, 0);
  });
  it('gives the same result at 30, 60 and 144 frames per second', () => {
    const at = (dt: number) => {
      const { r } = fresh(1000, 1000);
      r.zoomBy(-300); r.rotateBy(.5);
      run(r, .6, 2000, 1500, dt);
      return [r.fx, r.fy, r.dist, r.yaw];
    };
    const a = at(1 / 30), b = at(1 / 60), c = at(1 / 144);
    for (const o of [a, b]) { expect(Math.abs(o[0] - c[0])).toBeLessThan(10); expect(Math.abs(o[1] - c[1])).toBeLessThan(6); expect(Math.abs(o[2] - c[2])).toBeLessThan(.3); expect(Math.abs(o[3] - c[3])).toBeLessThan(.01); }
  });
  it('does not move while paused (dt = 0) but still returns a valid pose', () => {
    const { r } = fresh(); r.addShake(1);
    const a = { ...r.update(0, 1900, 1900, PITCH, flat, flat) }, b = { ...r.update(0, 1900, 1900, PITCH, flat, flat) };
    expect(b).toEqual(a); expect(r.fx).toBe(1600); expect(Number.isFinite(a.px) && Number.isFinite(a.py) && Number.isFinite(a.pz)).toBe(true);
  });
});

describe('CamRig zoom', () => {
  it('zooms multiplicatively (every notch feels the same) and clamps to the limits', () => {
    const { r } = fresh();
    r.zoomBy(100); expect(r.distGoal).toBeCloseTo(48 * Math.exp(.09), 6);
    r.zoomBy(-100); expect(r.distGoal).toBeCloseTo(48, 6);
    for (let i = 0; i < 100; i++) r.zoomBy(-400);
    expect(r.distGoal).toBe(ZOOM_MIN);
    for (let i = 0; i < 200; i++) r.zoomBy(400);
    expect(r.distGoal).toBe(ZOOM_MAX);
  });
  it('glides to the goal: no jump, no overshoot, inside the limits all the way', () => {
    const { r } = fresh();
    r.setZoom(ZOOM_MAX);
    let prev = r.dist, maxStep = 0;
    for (let i = 0; i < 90; i++) {
      r.update(DT, 1600, 1600, PITCH, flat, flat);
      maxStep = Math.max(maxStep, Math.abs(r.dist - prev)); prev = r.dist;
      expect(r.dist).toBeLessThanOrEqual(ZOOM_MAX + 1); expect(r.dist).toBeGreaterThanOrEqual(ZOOM_MIN - 1);
    }
    expect(maxStep).toBeGreaterThan(1); expect(maxStep).toBeLessThan(6); // 62 units in 1.5 s, at most ~5 per frame at the fastest
    expect(Math.abs(r.dist - ZOOM_MAX)).toBeLessThan(.1);
  });
});

describe('CamRig rotation', () => {
  it('rotateStep snaps to the eight 45 degree directions, and eight steps make a full turn', () => {
    const { r } = fresh(), q = Math.PI / 4;
    r.rotateStep(1); expect(r.yawGoal).toBeCloseTo(0, 6); // from the classic isometric angle to the axis
    r.rotateStep(1); expect(r.yawGoal).toBeCloseTo(q, 6);
    r.rotateStep(-1); r.rotateStep(-1); r.rotateStep(-1); expect(r.yawGoal).toBeCloseTo(-2 * q, 6);
    for (let i = 0; i < 8; i++) r.rotateStep(1);
    expect(r.yawGoal).toBeCloseTo(-2 * q + 2 * Math.PI, 6);
    r.resetYaw(); expect(r.yawGoal).toBe(DEFAULT_YAW);
  });
  it('glides to the new angle and keeps the yaw within one turn however long it is rotated', () => {
    const { r } = fresh();
    const s = r.yaw; r.rotateBy(1); r.update(DT, 1600, 1600, PITCH, flat, flat);
    expect(r.yaw - s).toBeGreaterThan(0); expect(r.yaw - s).toBeLessThan(.2); // moved, but not the whole radian at once
    for (let i = 0; i < 60; i++) { r.rotateBy(.5); run(r, .25, 1600, 1600); expect(Math.abs(r.yaw)).toBeLessThanOrEqual(Math.PI + 1e-9); }
  });
});

describe('CamRig pose', () => {
  it('stays an isometric camera: fixed pitch and exact distance for any zoom and rotation', () => {
    const { r } = fresh();
    for (const [yaw, dist] of [[DEFAULT_YAW, 48], [0, 25], [1.2, 110], [-2.9, 70], [3.1, 33]]) {
      r.yawGoal = yaw; r.distGoal = dist;
      const P = run(r, 3, 1600, 1600), dx = P.px - P.lx, dy = P.py - P.ly, dz = P.pz - P.lz, d = Math.hypot(dx, dy, dz);
      expect(d).toBeCloseTo(dist, 1); expect(Math.asin(dy / d)).toBeCloseTo(PITCH, 3);
      expect(Math.cos(Math.atan2(dx, dz))).toBeCloseTo(Math.cos(yaw), 2); expect(Math.sin(Math.atan2(dx, dz))).toBeCloseTo(Math.sin(yaw), 2);
    }
  });
  it('looks at the focus on the ground: the look-at point is the focus, in world units', () => {
    const { r } = fresh(1000, 2000), P = run(r, 1, 1000, 2000);
    expect(P.lx).toBeCloseTo(1000 * K, 6); expect(P.lz).toBeCloseTo(2000 * K, 6); expect(P.ly).toBeCloseTo(0, 6);
  });
  it('shakes and punches only what is drawn: the picking pose stays exactly where it was', () => {
    const a = fresh().r, b = fresh().r;
    b.addShake(1); b.addKick(.8, 3, 4);
    let max = 0;
    for (let i = 0; i < 30; i++) {
      const pa = a.update(DT, 1600, 1600, PITCH, flat, flat), pb = b.update(DT, 1600, 1600, PITCH, flat, flat);
      for (const k of ['ax', 'ay', 'az', 'alx', 'aly', 'alz'] as const) expect(pb[k]).toBe(pa[k]);
      max = Math.max(max, shift(pb));
    }
    expect(max).toBeGreaterThan(.05); // ... while the picture did move
  });
  it('keeps shake within its amplitude and roll, and returns to rest exactly', () => {
    const { r } = fresh();
    r.addShake(1);
    let max = 0, roll = 0;
    for (let i = 0; i < 120; i++) { const P = r.update(DT, 1600, 1600, PITCH, flat, flat); max = Math.max(max, shift(P)); roll = Math.max(roll, Math.abs(P.roll)); }
    expect(max).toBeGreaterThan(.2); expect(max).toBeLessThanOrEqual(Math.SQRT2 * SHAKE.amp + 1e-9); expect(roll).toBeLessThanOrEqual(SHAKE.roll + 1e-12);
    const P = r.update(DT, 1600, 1600, PITCH, flat, flat); // 2 s later: trauma drains at 1.5 / s
    expect([P.lx, P.ly, P.lz, P.roll]).toEqual([P.alx, P.aly, P.alz, 0]);
  });
  it('scales the shake amplitude with the distance, so a close-up does not shake out of proportion', () => {
    const peak = (dist: number) => { const { r } = fresh(); r.setZoom(dist); run(r, 3, 1600, 1600); r.addShake(1); let m = 0; for (let i = 0; i < 60; i++) m = Math.max(m, shift(r.update(DT, 1600, 1600, PITCH, flat, flat))); return m; };
    expect(peak(ZOOM_MIN)).toBeLessThan(peak(ZOOM_MAX) * .6);
  });
  it('pushes in on a kick, away from the blast, and settles back to rest', () => {
    const { r } = fresh();
    r.addKick(.5, 1, 0);
    let minD = Infinity, maxX = 0;
    for (let i = 0; i < 40; i++) {
      const P = r.update(DT, 1600, 1600, PITCH, flat, flat);
      minD = Math.min(minD, Math.hypot(P.px - P.lx, P.py - P.ly, P.pz - P.lz)); maxX = Math.max(maxX, P.lx - P.alx);
    }
    expect(minD).toBeLessThan(48 * .99); expect(minD).toBeGreaterThanOrEqual(48 * (1 - .07) - 1e-6); // pushes in, by at most 7 %
    expect(maxX).toBeGreaterThan(.05); // shoved along +x, away from a blast on the -x side
    const P = run(r, 2, 1600, 1600);
    expect(Math.hypot(P.px - P.lx, P.py - P.ly, P.pz - P.lz)).toBeCloseTo(48, 2); expect(shift(P)).toBeLessThan(1e-3);
  });
  it('honours reduced motion: shake and kicks shrink to a fraction', () => {
    const peak = (motion: number) => { const { r } = fresh(); r.motion = motion; r.addShake(1); r.addKick(1, 1, 1); let m = 0; for (let i = 0; i < 60; i++) m = Math.max(m, shift(r.update(DT, 1600, 1600, PITCH, flat, flat))); return m; };
    expect(peak(.25)).toBeLessThan(peak(1) * .4); expect(peak(0)).toBe(0);
  });
});

describe('CamRig terrain', () => {
  it('lifts the focus over rising ground smoothly instead of in one jolt', () => {
    const { r } = fresh(1600, 1500), cliff = (_x: number, y: number) => (y > 1600 ? 10 : 0);
    let prev = r.fh, maxStep = 0;
    for (let i = 0; i < 400; i++) { r.update(DT, 1600, 1900, PITCH, cliff, flat); maxStep = Math.max(maxStep, Math.abs(r.fh - prev)); prev = r.fh; }
    expect(maxStep).toBeGreaterThan(.01); expect(maxStep).toBeLessThan(.5); // a 10 unit cliff, at most half a unit per frame
    expect(r.fh).toBeCloseTo(10, 1);
  });
  it('keeps the camera above the terrain: rises quickly when a hill gets in the way and sinks back slowly', () => {
    const { r } = fresh();
    r.setZoom(ZOOM_MIN); run(r, 2, 1600, 1600);
    const base = r.pose.ay;
    expect(run(r, 1, 1600, 1600, DT, flat, () => 30).ay).toBeCloseTo(33, 1); // 30 + 3 of clearance
    expect(run(r, .2, 1600, 1600).ay - base).toBeGreaterThan(5); // still mostly up .2 s after the hill is gone
    expect(run(r, 3, 1600, 1600).ay).toBeCloseTo(base, 1);
  });
});

describe('CamRig sync with app.cam', () => {
  it('adopts what another module wrote (a match start, an instant recenter) and nothing else', () => {
    const r = new CamRig(W, K), c = { k: { x: 500, y: 700 }, cy: 1, cd: 60 };
    r.sync(c);
    expect([r.fx, r.fy, r.yaw, r.dist, r.yawGoal, r.distGoal]).toEqual([500, 700, 1, 60, 1, 60]);
    r.update(DT, 1400, 700, PITCH, flat, flat); r.update(DT, 1400, 700, PITCH, flat, flat); r.publish(c);
    expect(c.k.x).toBe(r.fx); expect(c.k.x).toBeGreaterThan(500); expect(c.cd).toBe(r.dist);
    const x = r.fx;
    r.sync(c); expect(r.fx).toBe(x); // nothing changed behind its back: it keeps gliding
    c.k.x = 2000; r.sync(c); expect(r.fx).toBe(2000); // somebody moved it: snap
    c.cd = 500; r.sync(c); expect(r.distGoal).toBe(ZOOM_MAX); expect(r.dist).toBe(ZOOM_MAX);
  });
  it('reset() drops shake, punch and the finale, and adopts the next match start even if nothing changed', () => {
    const { r, c } = fresh(1000, 1000);
    r.publish(c);
    run(r, 1, 1500, 1000);
    r.addShake(1); r.addKick(1, 1, 1); r.finale(100, 100);
    r.sync(c); expect(r.fx).toBeGreaterThan(1400); // the rig is ahead of app.cam, and that is fine
    r.reset();
    expect(r.shake.trauma).toBe(0); expect(r.finaleActive).toBe(false);
    r.sync(c); expect(r.fx).toBe(1000);
    expect(shift(r.update(DT, 1000, 1000, PITCH, flat, flat))).toBe(0);
  });
});

describe('CamRig finale', () => {
  it('drifts to the fallen core, draws closer, and ignores the wheel while it plays', () => {
    const { r } = fresh(1000, 1000);
    r.finale(2800, 2800);
    expect(r.finaleActive).toBe(true);
    r.zoomBy(-1000); expect(r.distGoal).toBe(48);
    run(r, 3, 1000, 1000); // the hero, which the camera would otherwise follow, has not moved
    expect(r.fx).toBeCloseTo(2800, 0); expect(r.fy).toBeCloseTo(2800, 0); expect(r.dist).toBeCloseTo(40, 0);
  });
  it('does not pull back out when already closer than the finale distance, and stays inside the map', () => {
    const { r } = fresh(1000, 1000);
    r.setZoom(30); run(r, 2, 1000, 1000);
    r.finale(99999, 99999);
    run(r, 3, 1000, 1000);
    expect(r.dist).toBeCloseTo(30, 0); expect(r.fx).toBeLessThanOrEqual(W - boundsMargin(30) + .5);
  });
});
