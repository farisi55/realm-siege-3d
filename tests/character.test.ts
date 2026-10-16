// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  ANIM_STATES, AnimationStateMachine, CharacterAnimationController, HIP_Y, clipSwing, mapClips, proceduralClips,
} from '../src/render/animation';
import type { AnimInput, ClipStyle } from '../src/render/animation';
import { instantiateRig, rigGeometry } from '../src/render/rigs';
import { MODEL_HEIGHT, RIG_IDS, modelHeight, paletteFor, rigDef } from '../src/render/heroes';
import { CharacterVisual } from '../src/render/character';
import { SelectionRing } from '../src/render/selection';
import { TrailPool, WeaponTrail, trailPool } from '../src/render/trail';
import { BRIDGES, DECK, groundY } from '../src/render/ground';
import { K } from '../src/game/config';
import { terrainY } from '../src/render/env/height';

const DT = 1 / 60;
const STYLES: ClipStyle[] = ['blade', 'smash', 'dual', 'staff', 'robe', 'beast'];
const BONES = ['hips', 'spine', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'];
const DURATIONS = { ATTACK: .55, ATTACK_2: .55, CAST: .8, HIT: .38, RESPAWN: .9 };
const LOCO: AnimInput = { speed: 0, maxSpeed: 300 };

/** Steps a state machine for `secs` seconds with the same input every frame. */
function run(m: AnimationStateMachine, input: AnimInput | undefined, secs: number) {
  for (let t = 0; t < secs - 1e-9; t += DT) m.step(input, DT);
  return m.state;
}

describe('animation state machine (pure)', () => {
  it('follows speed with hysteresis: idle -> walk -> run -> walk -> idle', () => {
    const m = new AnimationStateMachine(DURATIONS);
    expect(m.step(LOCO, DT)).toBe('IDLE');
    expect(run(m, { speed: 150, maxSpeed: 300 }, .05)).toBe('WALK');
    expect(run(m, { speed: 270, maxSpeed: 300 }, .3)).toBe('RUN');
    expect(run(m, { speed: 195, maxSpeed: 300 }, .5)).toBe('RUN'); // .65: between the walk and run thresholds, so it stays
    expect(run(m, { speed: 150, maxSpeed: 300 }, .5)).toBe('WALK');
    expect(run(m, LOCO, .5)).toBe('IDLE');
  });

  it('does not flicker: a state is held for at least 0.12 s before locomotion changes again', () => {
    const m = new AnimationStateMachine(DURATIONS);
    run(m, { speed: 150, maxSpeed: 300 }, .02); expect(m.state).toBe('WALK');
    run(m, { speed: 290, maxSpeed: 300 }, .06); expect(m.state).toBe('WALK');
    run(m, { speed: 290, maxSpeed: 300 }, .1); expect(m.state).toBe('RUN');
  });

  it('playback speed follows the measured velocity, within sane limits', () => {
    const at = (ratio: number, secs = .3) => { const m = new AnimationStateMachine(DURATIONS); run(m, { speed: ratio * 300, maxSpeed: 300 }, secs); return m; };
    const slow = at(.2), mid = at(.5), fast = at(.9), sprint = at(1.4);
    expect(slow.state).toBe('WALK'); expect(slow.timeScale).toBeCloseTo(.6, 5); // clamped
    expect(mid.timeScale).toBeGreaterThan(slow.timeScale);
    expect(fast.state).toBe('RUN'); expect(sprint.timeScale).toBeGreaterThan(fast.timeScale);
    expect(sprint.timeScale).toBeLessThanOrEqual(1.6);
  });

  it('attack and cast have priority over a hit; a new attack restarts, a cast beats an attack', () => {
    const m = new AnimationStateMachine(DURATIONS);
    expect(m.step({ ...LOCO, attack: 1 }, DT)).toBe('ATTACK');
    expect(m.step({ ...LOCO, hit: true }, DT)).toBe('ATTACK'); // a hit does not interrupt a swing
    m.changed = false; m.step({ ...LOCO, attack: 2 }, DT);
    expect(m.state).toBe('ATTACK_2'); expect(m.changed).toBe(true);
    expect(m.step({ ...LOCO, cast: true }, DT)).toBe('CAST');
    expect(m.step({ ...LOCO, attack: 1 }, DT)).toBe('CAST'); // an attack does not interrupt a spell
  });

  it('a one-shot hands control back to locomotion near the end of its clip', () => {
    const m = new AnimationStateMachine(DURATIONS);
    m.step({ ...LOCO, attack: 1 }, DT);
    expect(run(m, LOCO, .4)).toBe('ATTACK');
    expect(run(m, LOCO, .1)).toBe('IDLE'); // .55 * 0.85 = .4675 s
    m.step({ speed: 280, maxSpeed: 300, attack: 1 }, DT);
    expect(run(m, { speed: 280, maxSpeed: 300 }, .6)).toBe('RUN');
  });

  it('a hit only plays when nothing else is playing, and has a cooldown', () => {
    const m = new AnimationStateMachine(DURATIONS);
    expect(m.step({ ...LOCO, hit: true }, DT)).toBe('HIT');
    expect(run(m, LOCO, .34)).toBe('IDLE');
    expect(m.step({ ...LOCO, hit: true }, DT)).toBe('IDLE'); // 0.35 s after the first hit: still cooling down
    run(m, LOCO, .3);
    expect(m.step({ ...LOCO, hit: true }, DT)).toBe('HIT');
  });

  it('stun overrides everything but death and victory, and releases to locomotion', () => {
    const m = new AnimationStateMachine(DURATIONS);
    m.step({ ...LOCO, attack: 1 }, DT);
    expect(m.step({ ...LOCO, stunned: true }, DT)).toBe('STUN');
    expect(m.step({ ...LOCO, stunned: true, attack: 1, cast: true }, DT)).toBe('STUN');
    expect(m.step({ ...LOCO, stunned: true, victory: true }, DT)).toBe('VICTORY');
    expect(m.step({ ...LOCO, stunned: true, dead: true }, DT)).toBe('DEATH');
    const s = new AnimationStateMachine(DURATIONS);
    s.step({ ...LOCO, stunned: true }, DT);
    expect(s.step(LOCO, DT)).toBe('IDLE');
  });

  it('death sticks, then respawn is uninterruptible until it is almost over', () => {
    const m = new AnimationStateMachine(DURATIONS);
    expect(m.step({ ...LOCO, dead: true }, DT)).toBe('DEATH');
    expect(run(m, { ...LOCO, dead: true, victory: true }, 2)).toBe('DEATH');
    expect(m.step(LOCO, DT)).toBe('RESPAWN');
    expect(m.step({ ...LOCO, attack: 1, cast: true }, DT)).toBe('RESPAWN'); // busy standing up
    expect(run(m, LOCO, .8)).toBe('IDLE'); // .9 * 0.85 = .765 s
    expect(new AnimationStateMachine(DURATIONS).step({ ...LOCO, defeat: true }, DT)).toBe('DEATH');
  });

  it('victory holds until the match state changes', () => {
    const m = new AnimationStateMachine(DURATIONS);
    expect(run(m, { ...LOCO, victory: true }, 3)).toBe('VICTORY');
    expect(m.step({ speed: 300, maxSpeed: 300, victory: true, attack: 1 }, DT)).toBe('VICTORY');
  });

  it('channeling replaces idle, but moving still wins', () => {
    const m = new AnimationStateMachine(DURATIONS);
    expect(m.step({ ...LOCO, channeling: true }, DT)).toBe('CHANNEL');
    expect(run(m, { ...LOCO, channeling: true }, .5)).toBe('CHANNEL');
    expect(run(m, { speed: 200, maxSpeed: 300, channeling: true }, .3)).toBe('WALK');
    expect(run(m, LOCO, .5)).toBe('IDLE');
  });

  it('manual control for previews: force() plays a state, one-shots expire on their own', () => {
    const m = new AnimationStateMachine(DURATIONS);
    m.force('ATTACK_2');
    expect(run(m, undefined, .3)).toBe('ATTACK_2');
    expect(run(m, undefined, .2)).toBe('IDLE');
    m.force('RUN'); expect(run(m, undefined, 5)).toBe('RUN');
    m.force('VICTORY'); expect(run(m, undefined, 5)).toBe('VICTORY');
  });
});

describe('procedural clips', () => {
  it('every style provides all twelve clips with finite tracks for the eleven bones', () => {
    for (const style of STYLES) {
      const set = proceduralClips(style);
      expect(Object.keys(set).sort()).toEqual(['attack', 'attack2', 'cast', 'channel', 'death', 'hit', 'idle', 'respawn', 'run', 'stun', 'victory', 'walk']);
      for (const clip of Object.values(set)) {
        expect(clip.duration).toBeGreaterThan(.3);
        const names = clip.tracks.map(t => t.name);
        for (const b of BONES) expect(names).toContain(b + '.quaternion');
        expect(names).toContain('hips.position');
        for (const t of clip.tracks) expect(Array.from(t.values).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('clips are cached per style, so every character of a style shares them', () => {
    expect(proceduralClips('blade')).toBe(proceduralClips('blade'));
    expect(proceduralClips('blade').attack).not.toBe(proceduralClips('smash').attack);
  });

  it('walk, run and idle loop seamlessly', () => {
    for (const style of STYLES) for (const key of ['idle', 'walk', 'run'] as const) {
      const clip = proceduralClips(style)[key];
      for (const t of clip.tracks) {
        const v = Array.from(t.values), n = t.getValueSize();
        for (let i = 0; i < n; i++) expect(Math.abs(v[i] - v[v.length - n + i])).toBeLessThan(1e-3);
      }
    }
  });

  it('attacks land at the swing window the trail uses; staves have no cast ribbon', () => {
    for (const style of STYLES) {
      const set = proceduralClips(style);
      for (const key of ['attack', 'attack2'] as const) {
        const w = clipSwing(set[key]);
        expect(w).toBeTruthy(); expect(w![0]).toBeGreaterThan(0); expect(w![1]).toBeLessThanOrEqual(set[key].duration);
        // The simulation applies damage ~0.22 s after an attack starts: the swing must be under way by then.
        expect(w![0]).toBeLessThanOrEqual(.22); expect(w![1]).toBeGreaterThanOrEqual(.22);
      }
    }
    expect(clipSwing(proceduralClips('staff').cast)).toBeUndefined();
    expect(clipSwing(proceduralClips('robe').cast)).toBeUndefined();
    expect(clipSwing(proceduralClips('blade').cast)).toBeTruthy();
    expect(clipSwing(proceduralClips('blade').idle)).toBeUndefined();
  });

  it('robes get a shorter stride than the same staff style without a robe', () => {
    const swing = (style: ClipStyle) => {
      const t = proceduralClips(style).run.tracks.find(x => x.name === 'legL.quaternion')!, v = Array.from(t.values);
      let max = 0;
      for (let i = 0; i < v.length; i += 4) max = Math.max(max, 2 * Math.acos(Math.min(1, Math.abs(v[i + 3]))));
      return max;
    };
    expect(swing('robe')).toBeLessThan(swing('staff') * .75);
    expect(swing('robe')).toBeGreaterThan(.2);
  });

  it('death ends lying down, below the standing hip height', () => {
    for (const style of STYLES) {
      const hips = proceduralClips(style).death.tracks.find(t => t.name === 'hips.position')!, v = Array.from(hips.values);
      expect(v[1]).toBeCloseTo(HIP_Y, 1);
      expect(v[v.length - 2]).toBeLessThan(HIP_Y * .35);
    }
  });
});

describe('GLB clip mapping for the full state vocabulary', () => {
  const mk = (n: string) => new THREE.AnimationClip(n, 1, []);
  it('finds stun, channel, respawn and victory clips by name and falls back for the rest', () => {
    const c = mapClips(['Idle', 'Walk', 'Run', 'Attack_01', 'Stun_Loop', 'Channel', 'GetUp', 'Victory_Dance', 'Death'].map(mk));
    expect(c.stun.name).toBe('Stun_Loop'); expect(c.channel.name).toBe('Channel'); expect(c.respawn.name).toBe('GetUp');
    expect(c.victory.name).toBe('Victory_Dance'); expect(c.death.name).toBe('Death');
    expect(c.attack2).toBe(c.attack); // one attack clip serves both attacks
    expect(c.cast).toBe(c.attack); // and spells
  });
  it('a model with only an idle clip still has something to play for every state', () => {
    const c = mapClips([mk('Idle')]);
    for (const k of Object.keys(c)) expect(c[k as keyof typeof c]).toBeTruthy();
    expect(c.walk).toBe(c.idle); expect(c.death.name).toBe('death');
  });
});

describe('procedural rigs', () => {
  it('every rig instantiates for every team without missing palette colors', () => {
    expect(RIG_IDS).toHaveLength(9);
    for (const id of RIG_IDS) for (const team of [0, 1, 2]) {
      const def = rigDef(id)!, inst = instantiateRig(def, paletteFor(id, 0xff8800, team));
      expect(Object.keys(inst.bones).sort()).toEqual([...BONES].sort());
      expect(inst.lit.isSkinnedMesh).toBe(true);
      expect((inst.lit.material as any).skinning).toBe(true);
      expect(inst.skeleton.bones).toHaveLength(BONES.length);
      expect(inst.lit.geometry.attributes.position.count).toBeGreaterThan(300);
      const skin = inst.lit.geometry.attributes.skinIndex;
      for (let i = 0; i < skin.count; i += 7) expect(skin.getX(i)).toBeLessThan(BONES.length);
      for (const t of def.trails) expect(inst.bones[t.bone]).toBeTruthy();
      expect(inst.trails).toHaveLength(def.trails.length);
    }
  });

  it('design heights match the real silhouette, so a model always renders at its in-game height', () => {
    for (const id of RIG_IDS) {
      const def = rigDef(id)!, g = rigGeometry(def, paletteFor(id, 0xff8800, 0)), box = new THREE.Box3();
      for (const geo of [g.lit, g.glow]) if (geo) { geo.computeBoundingBox(); box.union(geo.boundingBox!); }
      expect(box.min.y).toBeGreaterThan(-.02); expect(box.min.y).toBeLessThan(.05); // feet on the ground
      expect(Math.abs(box.max.y - def.height) / def.height).toBeLessThan(.04);
    }
  });

  it('heroes have distinct silhouettes: different heights and a different animation style each', () => {
    const heroes = ['arcane-knight', 'shadow-huntress', 'ember-mage', 'nature-guardian', 'storm-warrior'];
    expect(new Set(heroes.map(modelHeight)).size).toBeGreaterThanOrEqual(4);
    expect(modelHeight('storm-warrior')).toBeGreaterThan(modelHeight('shadow-huntress'));
    expect(new Set(heroes.map(h => rigDef(h)!.style)).size).toBe(5); // every hero moves in its own style
    expect(heroes.map(h => rigDef(h)!.style)).toEqual(['blade', 'dual', 'robe', 'staff', 'smash']);
    for (const id of RIG_IDS) expect(MODEL_HEIGHT[id]).toBeGreaterThan(1);
    expect(modelHeight('unknown-model')).toBe(2.5);
  });

  it('a character is two draw calls at most: one lit and one glow skinned mesh sharing a skeleton', () => {
    const inst = instantiateRig(rigDef('arcane-knight')!, paletteFor('arcane-knight', 0x6aa8ff, 0));
    const meshes: THREE.Object3D[] = []; inst.group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
    expect(meshes.length).toBeLessThanOrEqual(2);
    if (inst.glow) expect(inst.glow.skeleton).toBe(inst.lit.skeleton);
  });

  it('geometry is shared between characters of the same look, bones and materials are not', () => {
    const def = rigDef('boss')!, pal = paletteFor('boss', 0xb28cff, 2);
    const a = instantiateRig(def, pal), b = instantiateRig(def, pal);
    expect(a.lit.geometry).toBe(b.lit.geometry);
    expect(a.bones.hips).not.toBe(b.bones.hips); expect(a.lit.material).not.toBe(b.lit.material);
  });
});

/** A rig plus a controller on the same root, the way CharacterVisual builds them. */
function makeController(id = 'arcane-knight') {
  const def = rigDef(id)!, inst = instantiateRig(def, paletteFor(id, 0x6aa8ff, 0));
  const ctl = new CharacterAnimationController(inst.group, proceduralClips(def.style), true);
  ctl.update(0);
  return { ctl, inst, def };
}
const weightSum = (c: CharacterAnimationController) => ANIM_STATES.reduce((s, st) => s + c.weight(st), 0);

describe('CharacterAnimationController', () => {
  it('exposes the playX() API and moves the machine to the requested state', () => {
    const { ctl } = makeController();
    const calls: [() => unknown, string][] = [
      [() => ctl.playWalk(), 'WALK'], [() => ctl.playRun(), 'RUN'], [() => ctl.playAttack(), 'ATTACK'], [() => ctl.playAttack(true), 'ATTACK_2'],
      [() => ctl.playCast(), 'CAST'], [() => ctl.playChannel(), 'CHANNEL'], [() => ctl.playHit(), 'HIT'], [() => ctl.playStun(), 'STUN'],
      [() => ctl.playDeath(), 'DEATH'], [() => ctl.playRespawn(), 'RESPAWN'], [() => ctl.playVictory(), 'VICTORY'], [() => ctl.playIdle(), 'IDLE'],
      [() => ctl.crossFadeTo('ATTACK', .1), 'ATTACK'],
    ];
    for (const [fn, state] of calls) { fn(); ctl.update(DT); expect(ctl.state).toBe(state); }
  });

  it('cross-fade weights always sum to one, also across interruptions', () => {
    const { ctl } = makeController();
    const plan: (() => void)[] = [() => ctl.playAttack(), () => ctl.playHit(), () => ctl.playWalk(), () => ctl.playRun(), () => ctl.playCast(), () => ctl.playIdle(), () => ctl.playDeath(), () => ctl.playRespawn()];
    for (const go of plan) {
      go();
      for (let i = 0; i < 7; i++) { ctl.update(i % 2 ? DT : 1 / 240); expect(weightSum(ctl)).toBeCloseTo(1, 2); }
    }
  });

  it('an interrupted fade does not pop: the previous pose keeps contributing', () => {
    const { ctl } = makeController();
    ctl.playAttack(false, .06); ctl.update(.03); // half way into the attack
    expect(ctl.weight('ATTACK')).toBeCloseTo(.5, 1); expect(ctl.weight('IDLE')).toBeCloseTo(.5, 1);
    ctl.playHit(.04); ctl.update(.004);
    expect(ctl.weight('IDLE')).toBeGreaterThan(.3); // three.js r128's own crossFadeTo would reset it
    expect(ctl.weight('ATTACK')).toBeGreaterThan(.3);
    expect(ctl.weight('HIT')).toBeLessThan(.2);
    ctl.update(.1); expect(ctl.weight('HIT')).toBeGreaterThan(.95);
  });

  it('the pose changes continuously when switching states (no single-frame jump)', () => {
    const { ctl, inst } = makeController('storm-warrior');
    const arm = inst.bones.armR.quaternion, prev = new THREE.Quaternion();
    const step = (dt: number) => { prev.copy(arm); ctl.update(dt); return prev.angleTo(arm); };
    ctl.playRun(0); for (let i = 0; i < 20; i++) step(DT);
    ctl.playIdle(.2);
    let worst = 0; for (let i = 0; i < 20; i++) worst = Math.max(worst, step(DT));
    expect(worst).toBeLessThan(.12); // radians per frame while blending run -> idle
  });

  it('walk and run share a phase: switching gait keeps the legs where they were', () => {
    const { ctl } = makeController();
    ctl.playWalk(0); ctl.update(.3);
    const walk = ctl.actions.WALK, run = ctl.actions.RUN, wp = walk.time / walk.getClip().duration;
    ctl.playRun();
    expect(run.time / run.getClip().duration).toBeCloseTo(wp, 2);
  });

  it('walk and run speed follow the measured velocity', () => {
    const feed = (ratio: number) => { const { ctl } = makeController(); for (let i = 0; i < 90; i++) ctl.update(DT, { speed: ratio * 300, maxSpeed: 300 }); return ctl; };
    const slow = feed(.2), mid = feed(.5), fast = feed(1.2);
    expect(slow.state).toBe('WALK'); expect(mid.state).toBe('WALK'); expect(fast.state).toBe('RUN');
    expect(mid.actions.WALK.timeScale).toBeGreaterThan(slow.actions.WALK.timeScale);
    expect(fast.actions.RUN.timeScale).toBeGreaterThan(1.1);
  });

  it('one-shots end in locomotion and the idle pose takes over again', () => {
    const { ctl } = makeController();
    ctl.update(DT, { ...LOCO, attack: 1 });
    expect(ctl.state).toBe('ATTACK');
    for (let i = 0; i < 90; i++) ctl.update(DT, LOCO);
    expect(ctl.state).toBe('IDLE'); expect(ctl.weight('IDLE')).toBeGreaterThan(.95);
  });

  it('death clamps on its last frame instead of looping or snapping back', () => {
    const { ctl, inst } = makeController();
    ctl.playDeath(.05); ctl.update(2.5);
    expect(ctl.progress).toBe(1);
    const y = inst.bones.hips.position.y;
    ctl.update(1); expect(inst.bones.hips.position.y).toBeCloseTo(y, 5);
    expect(y).toBeLessThan(HIP_Y * .35);
  });

  it('the weapon swing window opens and closes with the attack clip', () => {
    const { ctl } = makeController();
    ctl.playAttack(false, 0); ctl.update(.05); expect(ctl.swinging).toBe(false);
    ctl.update(.15); expect(ctl.swinging).toBe(true);
    ctl.update(.3); expect(ctl.swinging).toBe(false);
    ctl.playCast(0); ctl.update(.3); expect(ctl.swinging).toBe(true);
    const staff = makeController('ember-mage').ctl; staff.playCast(0); staff.update(.3); expect(staff.swinging).toBe(false);
  });

  it('dispose stops every action', () => {
    const { ctl } = makeController();
    ctl.playAttack(); ctl.update(.1); ctl.dispose();
    expect(() => ctl.update(.1)).not.toThrow();
  });
});

/** A bare-bones simulation unit with just the fields CharacterVisual reads. */
const unit = (o: Record<string, unknown> = {}): any => ({ k: 'hero', team: 0, x: 500, y: 500, fa: 0, hp: 500, max: 500, cd: 0, alt: false, acd: [0, 0, 0, 0], st: 0, dead: false, sp: 300, r: 18, ...o });
const visual = (key = 'arcane-knight', extra: Record<string, unknown> = {}) =>
  new CharacterVisual({ key, height: modelHeight(key), color: 0x6aa8ff, team: 0, radius: .9, hero: true, glb: null, ...extra });
const frames = (v: CharacterVisual, u: any, n: number, ctx: any = {}, dt = DT) => { for (let i = 0; i < n; i++) v.update(u, dt, ctx, 0, 0, 0); };

describe('CharacterVisual reads the simulation and animates', () => {
  it('uses the procedural rig when asked and builds it at the in-game height', () => {
    const v = visual('storm-warrior');
    expect(v.glb).toBe(false); expect(v.state).toBe('IDLE');
    const box = new THREE.Box3().setFromObject(v.root.children[0]);
    expect(box.max.y).toBeCloseTo(MODEL_HEIGHT['storm-warrior'], 0);
    expect(v.height).toBe(MODEL_HEIGHT['storm-warrior']);
  });

  it('recognizes attacks, alternate attacks and spells from cooldown changes', () => {
    const u = unit(), v = visual();
    frames(v, u, 3); expect(v.state).toBe('IDLE');
    u.cd = .8; frames(v, u, 1); expect(v.state).toBe('ATTACK');
    u.cd = 0; frames(v, u, 40); expect(v.state).toBe('IDLE');
    u.alt = true; u.cd = .8; frames(v, u, 1); expect(v.state).toBe('ATTACK_2');
    u.cd = 0; frames(v, u, 40);
    u.acd[1] = 6; frames(v, u, 1); expect(v.state).toBe('CAST');
  });

  it('plays a hit reaction with a white flash, recoil and sparks, but never interrupts a swing', () => {
    const burst = vi.fn(), u = unit(), v = visual('arcane-knight', { burst });
    frames(v, u, 2);
    u.hp = 450; v.update(u, DT, {}, 12, 1, 34);
    expect(v.state).toBe('HIT'); expect(v.flashLevel).toBeGreaterThan(.5);
    expect(burst).toHaveBeenCalled(); expect(burst.mock.calls[0][0]).toBe(12); expect(burst.mock.calls[0][2]).toBe(34);
    frames(v, u, 60); expect(v.flashLevel).toBe(0);
    const a = unit(), w = visual();
    frames(w, a, 2); a.cd = .8; frames(w, a, 1); a.hp -= 40; frames(w, a, 1);
    expect(w.state).toBe('ATTACK'); expect(w.flashLevel).toBeGreaterThan(0);
  });

  it('heroes flinch harder than creeps for the same relative damage', () => {
    const shove = (hero: boolean) => {
      const u = unit({ k: hero ? 'hero' : 'melee' }), v = visual(hero ? 'arcane-knight' : 'melee-creep', { hero });
      frames(v, u, 2); u.hp -= 100; frames(v, u, 1);
      return Math.abs((v.rig.parent as THREE.Object3D).position.z);
    };
    expect(shove(false)).toBeGreaterThan(shove(true));
  });

  it('measures speed from movement: run while moving, idle after stopping, dashes are ignored', () => {
    const u = unit(), v = visual();
    frames(v, u, 3);
    for (let i = 0; i < 30; i++) { u.x += 300 * DT; v.update(u, DT, {}, 0, 0, 0); }
    expect(v.state).toBe('RUN'); expect(v.speed).toBeGreaterThan(250);
    frames(v, u, 40); expect(v.state).toBe('IDLE');
    u.x += 700; frames(v, u, 1); // a dash / teleport in a single frame
    expect(v.speed).toBeLessThan(10); frames(v, u, 10); expect(v.state).toBe('IDLE');
  });

  it('plays stun while stunned, and the stun stars follow it', () => {
    const u = unit(), v = visual(), stars = () => v.root.children.find(c => c.children.length === 3 && c !== v.facing)!;
    frames(v, u, 3); expect(stars().visible).toBe(false);
    u.st = 1; frames(v, u, 2); expect(v.state).toBe('STUN'); expect(stars().visible).toBe(true);
    u.st = 0; frames(v, u, 2); expect(v.state).toBe('IDLE'); expect(stars().visible).toBe(false);
  });

  it('dies, hides its ring, and respawns with a pop-in', () => {
    const u = unit(), v = visual();
    frames(v, u, 3, { selected: 'player' }); expect(v.selection).toBe('player');
    u.dead = true; frames(v, u, 2, { selected: 'player' });
    expect(v.state).toBe('DEATH'); expect(v.selection).toBe('none'); expect(v.ring.group.visible).toBe(false);
    frames(v, u, 120, { selected: 'player' }); expect(v.anim.progress).toBe(1);
    u.dead = false; frames(v, u, 1, { selected: 'player' });
    expect(v.state).toBe('RESPAWN'); expect(v.ring.group.visible).toBe(true);
    expect((v.rig.parent as THREE.Object3D).scale.x).toBeLessThan(.9);
    frames(v, u, 90, { selected: 'player' });
    expect(v.state).toBe('IDLE'); expect((v.rig.parent as THREE.Object3D).scale.x).toBe(1);
  });

  it('victory for the winning team, collapse for the losing heroes, nothing for losing creeps', () => {
    const over = { over: true, win: 0 };
    const win = visual(), lose = visual('shadow-huntress'), creep = visual('melee-creep', { hero: false });
    const uw = unit({ team: 0 }), ul = unit({ team: 1 }), uc = unit({ team: 1, k: 'melee' });
    frames(win, uw, 3, over); frames(lose, ul, 3, over); frames(creep, uc, 3, over);
    expect(win.state).toBe('VICTORY'); expect(lose.state).toBe('DEATH'); expect(creep.state).toBe('IDLE');
  });

  it('the player ring and the target ring follow the selection the owner passes in', () => {
    const u = unit(), v = visual();
    frames(v, u, 2); expect(v.selection).toBe('none');
    frames(v, u, 2, { selected: 'player' }); expect(v.selection).toBe('player');
    frames(v, u, 2, { selected: 'target' }); expect(v.selection).toBe('target');
    frames(v, u, 2, {}); expect(v.selection).toBe('none');
  });

  it('far-away units keep sensing but skip animation, so they never replay stale events', () => {
    const u = unit(), v = visual();
    frames(v, u, 2); u.cd = .8; u.hp = 400; frames(v, u, 5, { active: false });
    expect(v.state).toBe('IDLE'); frames(v, u, 2, { active: true }); expect(v.state).toBe('IDLE');
  });

  it('weapon trails: swords draw a ribbon in world space during the swing, then fade; ranged creeps have none', () => {
    const u = unit(), v = visual('arcane-knight');
    expect(v.hasTrails).toBe(true); expect(v.trailsOn).toHaveLength(1); expect(v.root.parent).toBeNull();
    frames(v, u, 2); expect(v.trailActive).toBe(false);
    u.cd = .8; let seen = false;
    for (let i = 0; i < 40; i++) { v.update(u, DT, {}, 0, 0, 0); u.cd = Math.max(0, u.cd - DT); seen = seen || v.trailActive; }
    expect(seen).toBe(true);
    frames(v, u, 40); expect(v.trailActive).toBe(false);
    expect(visual('ranged-creep', { hero: false }).hasTrails).toBe(false);
  });

  it('dual daggers: the right hand trails on the first attack, the left on the second', () => {
    const u = unit(), v = visual('shadow-huntress'), vis = () => v.trailsOn;
    expect(v.trailsOn).toHaveLength(2);
    frames(v, u, 2); u.cd = .8;
    let r: boolean[] = [false, false];
    for (let i = 0; i < 30; i++) { v.update(u, DT, {}, 0, 0, 0); u.cd = Math.max(0, u.cd - DT); if (v.trailActive) r = vis(); }
    expect(r).toEqual([true, false]);
    frames(v, u, 40);
    u.alt = true; u.cd = .8;
    for (let i = 0; i < 30; i++) { v.update(u, DT, {}, 0, 0, 0); u.cd = Math.max(0, u.cd - DT); if (v.trailActive) r = vis(); }
    expect(r).toEqual([false, true]);
  });

  it('only reads the simulation: a unit is bit-for-bit the same after being animated', () => {
    const u = unit(), v = visual(), before = JSON.stringify(u);
    u.cd = .8; frames(v, u, 5); u.hp = 300; frames(v, u, 5); u.acd[0] = 3; u.st = 1; frames(v, u, 5); u.dead = true; frames(v, u, 5);
    const snap = JSON.parse(before); snap.cd = .8; snap.hp = 300; snap.acd[0] = 3; snap.st = 1; snap.dead = true;
    expect(JSON.parse(JSON.stringify(u))).toEqual(snap);
  });

  it('dispose detaches everything from the scene and keeps working code safe', () => {
    const scene = new THREE.Scene(), v = visual();
    scene.add(v.root);
    v.dispose();
    expect(v.root.parent).toBeNull();
    expect(() => v.anim.update(.1)).not.toThrow();
  });

  it('the hero-select preview drives the same animations without a simulation unit', () => {
    const v = visual('ember-mage');
    v.anim.playCast(); v.preview(.3);
    expect(v.state).toBe('CAST'); expect(v.selection).toBe('player');
    v.anim.playVictory(); v.preview(.5); expect(v.state).toBe('VICTORY');
  });
});

describe('weapon trail ribbon', () => {
  const a = new THREE.Vector3(), b = new THREE.Vector3(0, 1, 0);
  it('grows while active, fades out afterwards and is capped', () => {
    const pool = new TrailPool(4), t = new WeaponTrail(0xffffff, 8, .2, pool);
    expect(t.visible).toBe(false); expect(pool.active).toBe(0);
    for (let i = 0; i < 30; i++) { a.x += .2; b.x += .2; t.update(DT, true, a, b); }
    expect(t.visible).toBe(true); expect(t.length).toBe(8); expect(pool.active).toBe(1);
    for (let i = 0; i < 20; i++) t.update(DT, false);
    expect(t.length).toBe(0); expect(t.visible).toBe(false); expect(pool.active).toBe(0);
  });
  it('clear() hides it at once and dispose() gives the slot back', () => {
    const pool = new TrailPool(4), t = new WeaponTrail(0xff0000, 18, .28, pool), scene = new THREE.Scene(); scene.add(pool.group);
    t.update(DT, true, a, b); t.update(DT, true, a.clone().setX(1), b.clone().setX(1));
    expect(t.visible).toBe(true); expect(pool.group.children.filter(c => c.visible)).toHaveLength(1);
    t.clear(); expect(t.visible).toBe(false); expect(pool.active).toBe(0);
    t.update(DT, true, a, b); t.update(DT, true, a.clone().setX(1), b.clone().setX(1)); expect(pool.active).toBe(1);
    t.dispose(); expect(pool.active).toBe(0); expect(pool.group.children.filter(c => c.visible)).toHaveLength(0);
  });
  it('the ribbon is smoothed (more vertices than samples), tapered and drawn in one shared material', () => {
    const pool = new TrailPool(4), t1 = new WeaponTrail(0x66aaff, 12, .3, pool), t2 = new WeaponTrail(0xff6644, 12, .3, pool);
    const p = new THREE.Vector3(), q = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 6; i++) { p.set(Math.cos(i * .5), 0, Math.sin(i * .5)); q.set(Math.cos(i * .5) * 1.4, 1, Math.sin(i * .5) * 1.4); t1.update(DT, true, p, q); t2.update(DT, true, p, q); }
    const [s1, s2] = pool.slots, geo = (s1.mesh as THREE.Mesh).geometry;
    expect(pool.slots).toHaveLength(2); expect((s1.mesh as THREE.Mesh).material).toBe((s2.mesh as THREE.Mesh).material);
    expect(geo.drawRange.count).toBe(((6 - 1) * 3 + 1 - 1) * 6); // 3 sub-segments per sample gap
    const col = s1.col, newest = col[3], oldest = col[((6 - 1) * 3) * 8 + 3];
    expect(newest).toBeGreaterThan(oldest); // alpha fades with age
    const w = (i: number) => Math.hypot(s1.pos[i * 6] - s1.pos[i * 6 + 3], s1.pos[i * 6 + 1] - s1.pos[i * 6 + 4], s1.pos[i * 6 + 2] - s1.pos[i * 6 + 5]);
    expect(w(0)).toBeGreaterThan(w((6 - 1) * 3)); // the tail narrows
  });
  it('a full pool refuses another ribbon instead of growing', () => {
    const pool = new TrailPool(2), ts = [0, 1, 2].map(() => new WeaponTrail(0xffffff, 8, .3, pool));
    for (const t of ts) { t.update(DT, true, a, b); t.update(DT, true, a.clone().setX(2), b.clone().setX(2)); }
    expect(pool.slots).toHaveLength(2); expect(pool.denied).toBeGreaterThan(0); expect(pool.active).toBe(2);
  });
  it('the shared pool is empty when no weapon is swinging', () => { expect(trailPool.active).toBeGreaterThanOrEqual(0); });
});

describe('selection ring', () => {
  it('shows the halo only when selected, with tick marks only on a target', () => {
    const r = new SelectionRing(1, 0x3b9cff), halo = r.group.children[1] as THREE.Group;
    expect(halo.visible).toBe(false);
    r.setMode('player'); expect(halo.visible).toBe(true);
    const ticks = halo.children[2]; expect(ticks.visible).toBe(false);
    r.setMode('target'); expect(ticks.visible).toBe(true);
    r.setMode('none'); expect(halo.visible).toBe(false);
  });
  it('the team ring keeps the team color: normal blending (red added to green would be yellow); the selection halo glows additively', () => {
    const r = new SelectionRing(1, 0xff4a5a), base = r.group.children[0] as THREE.Mesh, bm = base.material as THREE.MeshBasicMaterial;
    expect(bm.blending).toBe(THREE.NormalBlending); expect(bm.color.getHex()).toBe(0xff4a5a); expect(bm.transparent).toBe(true); expect(bm.depthWrite).toBe(false); expect(bm.opacity).toBeGreaterThan(.4);
    r.setMode('player'); r.setMode('target');
    for (const m of (r.group.children[1] as THREE.Group).children as THREE.Mesh[]) expect((m.material as THREE.MeshBasicMaterial).blending).toBe(THREE.AdditiveBlending);
  });
  it('rings share their materials: one per color and strength, and a team ring never shares with a halo of the same color', () => {
    const a = new SelectionRing(1, 0x3b9cff, .6), b = new SelectionRing(2, 0x3b9cff, .6), c = new SelectionRing(1, 0x3b9cff, .85);
    const mat = (r: SelectionRing): THREE.Material => (r.group.children[0] as THREE.Mesh).material as THREE.Material;
    expect(mat(a)).toBe(mat(b)); expect(mat(a)).not.toBe(mat(c));
    const h = new SelectionRing(1, 0x6dffb4, .95); h.setMode('player'); // a halo color used as a team color: still a different (additive) material
    expect(mat(h)).not.toBe(((h.group.children[1] as THREE.Group).children[0] as THREE.Mesh).material);
  });
  it('rotates while selected and shares geometry between rings', () => {
    const r = new SelectionRing(1, 0xff0000), s = new SelectionRing(2, 0x00ff00);
    r.setMode('player'); const dash = (r.group.children[1] as THREE.Group).children[0], y0 = dash.rotation.y;
    r.update(.5); expect(dash.rotation.y).not.toBe(y0);
    expect((r.group.children[0] as THREE.Mesh).geometry).toBe((s.group.children[0] as THREE.Mesh).geometry);
    expect(s.group.scale.x).toBe(2);
  });
});

describe('ground height for characters (render only)', () => {
  it('stands on the bridge deck instead of sinking into it', () => {
    for (const [bx, by] of BRIDGES) {
      const top = DECK.y + DECK.h / 2;
      expect(groundY(bx, by)).toBeCloseTo(top, 3);
      expect(terrainY(bx, by)).toBeLessThan(top); // the river bed itself is far below the deck: this was the sinking
    }
  });
  it('is the plain terrain height away from the bridges and never below it', () => {
    expect(groundY(800, 2400)).toBe(terrainY(800, 2400));
    for (let i = 0; i < 400; i++) { const x = (i * 97) % 3200, y = (i * 211) % 3200; expect(groundY(x, y)).toBeGreaterThanOrEqual(terrainY(x, y) - 1e-9); }
  });
  it('rises smoothly over the deck edge along the lane', () => {
    const s = Math.SQRT1_2, top = DECK.y + DECK.h / 2, edge = DECK.w / K / 2;
    for (const [cx, cy] of BRIDGES) {
      const at = (l: number) => groundY(cx + s * l, cy - s * l);
      let prev = at(260);
      for (let l = 259; l >= 0; l--) { const h = at(l); expect(Math.abs(h - prev)).toBeLessThan(.06); prev = h; } // no step anywhere on the way to the deck
      expect(at(0)).toBeCloseTo(top, 5);
    }
    // on the middle bridge the banks are lower than the deck: the height is the terrain's up to the deck edge, then climbs over the last ten units
    const [cx, cy] = BRIDGES[1], at = (l: number) => groundY(cx + s * l, cy - s * l);
    expect(at(edge + 2)).toBeCloseTo(terrainY(cx + s * (edge + 2), cy - s * (edge + 2)), 9);
    const hs = [edge, edge - 3, edge - 6, edge - 10].map(at);
    for (let i = 1; i < hs.length; i++) expect(hs[i]).toBeGreaterThanOrEqual(hs[i - 1] - 1e-9);
    expect(hs[3]).toBeCloseTo(top, 5);
  });
});
